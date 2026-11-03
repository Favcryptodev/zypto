// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IZypto {
    function owner() external view returns (address);
    function _marketingWallet() external view returns (address);
    function _uniswapV2Router() external view returns (address);
    function _WETH() external view returns (address);
    function balanceOf(address) external view returns (uint256);
    function transfer(address,uint256) external returns(bool);
    function _isExcludedFromFees(address) external view returns(bool);
}
interface IWrappedETH {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address,address,uint256) external returns (bool);
    function withdraw(uint256) external;
}
interface IBuyFactory {
    function getPair(address,address) external view returns (address);
}
interface IBuyPair {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112,uint112,uint32);
}
interface IBuyRouter {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function getAmountsOut(uint256,address[] calldata) external view returns(uint256[] memory);
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin, address[] calldata path, address to, uint256 deadline
    ) external payable;
}

/// @notice Fixed 75/25 ETH allocation with isolated, best-effort automatic processing on receipt.
/// @dev Generic core for testing. Deploy ZyptoFeeReceiver, the mainnet-only wrapper below.
abstract contract FeeReceiverCore {
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MARKETING_GAS = 40_000;
    uint256 public constant BUYBACK_GAS = 650_000;
    uint256 public constant WETH_GAS = 200_000;
    uint256 public constant MAX_SLIPPAGE_BPS = 1_000;
    uint256 public constant DEFAULT_SLIPPAGE_BPS = 300;
    uint256 private constant GAS_RESERVE = 70_000;
    IZypto public immutable token;
    IBuyRouter public immutable router;
    IBuyPair public immutable pair;
    bool private immutable wethIsToken0;
    address public immutable weth;
    address payable public immutable marketingWallet;
    address public owner;
    address public pendingOwner;
    uint256 public burnThreshold;
    uint256 public maxBuybackETH;
    uint256 public slippageBps;
    uint256 public marketingPending;
    uint256 public burnPending;
    uint256 public totalReceived;
    uint256 public totalMarketingPaid;
    uint256 public totalBuybackETH;
    uint256 public totalTokensSentToDead;
    bool public buybacksPaused;
    uint256 private entered = 1;
    bool private unwrapping;

    error Unauthorized();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidPair();
    error InvalidQuote();
    error InvalidDeadline();
    error BuybacksPaused();
    error PauseRequired();
    error ReentrantCall();
    error TransferFailed();
    error InsufficientOutput();
    event Received(address indexed sender, uint256 eth, uint256 marketing, uint256 buyback);
    event MarketingPaid(address indexed recipient, uint256 eth);
    event WETHDeposited(address indexed sender, uint256 amount);
    event WETHUnwrapped(uint256 amount);
    event WETHDeferred();
    event BuybackBurned(uint256 eth, uint256 tokens);
    event BurnThresholdChanged(uint256 oldThreshold, uint256 newThreshold);
    event BuybackLimitsChanged(uint256 maxETH, uint256 slippageBps);
    event MarketingDeferred(uint256 eth);
    event BuybackDeferred(uint256 eth);
    event BuybackPauseChanged(bool paused);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed nextOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event EmergencyETHWithdrawn(address indexed to, uint256 amount, uint256 marketingDebited, uint256 buybackDebited);
    event EmergencyTokenWithdrawn(address indexed asset, address indexed to, uint256 amount);

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier nonReentrant() { if (entered != 1) revert ReentrantCall(); entered = 2; _; entered = 1; }

    constructor(address tokenAddress, uint256 initialBurnThreshold, address initialPair) {
        if (tokenAddress.code.length == 0) revert InvalidAddress();
        if (initialBurnThreshold == 0) revert InvalidAmount();
        token = IZypto(tokenAddress);
        address initialOwner = token.owner();
        address marketing = token._marketingWallet();
        address routerAddress = token._uniswapV2Router();
        address wrappedETH = token._WETH();
        if (initialOwner == address(0) || initialOwner == address(this) || marketing == address(0)
            || marketing == address(this) || marketing == tokenAddress || routerAddress.code.length == 0
            || wrappedETH.code.length == 0) revert InvalidAddress();
        if (IBuyRouter(routerAddress).WETH() != wrappedETH) revert InvalidAddress();
        // The canonical V2 router executes the direct path through its factory's
        // unique pair. A supplied address cannot redirect the quote or the swap.
        address factory = IBuyRouter(routerAddress).factory();
        if (factory.code.length == 0 || initialPair.code.length == 0) revert InvalidPair();
        if (IBuyFactory(factory).getPair(tokenAddress, wrappedETH) != initialPair
            || IBuyPair(initialPair).factory() != factory) revert InvalidPair();
        (address first, address second) = tokenAddress < wrappedETH
            ? (tokenAddress, wrappedETH) : (wrappedETH, tokenAddress);
        if (IBuyPair(initialPair).token0() != first || IBuyPair(initialPair).token1() != second) revert InvalidPair();
        pair = IBuyPair(initialPair);
        wethIsToken0 = first == wrappedETH;
        owner = initialOwner; // Never msg.sender: the deployer has no authority.
        marketingWallet = payable(marketing); // Snapshot the existing live receiver before switching.
        router = IBuyRouter(routerAddress);
        weth = wrappedETH;
        burnThreshold = initialBurnThreshold;
        maxBuybackETH = initialBurnThreshold * 10;
        slippageBps = DEFAULT_SLIPPAGE_BPS;
        emit OwnershipTransferred(address(0), initialOwner);
        emit BurnThresholdChanged(0, initialBurnThreshold);
        emit BuybackLimitsChanged(maxBuybackETH, DEFAULT_SLIPPAGE_BPS);
    }

    /// @dev Accounting precedes attempts; failures retain allocations. This uses call(), not send()/transfer().
    ///      Reentrant receipts are accounted but do not recursively process.
    receive() external payable {
        // Canonical WETH9 withdraw uses transfer's 2,300-gas stipend. Do not write
        // storage here: the guarded unwrap frame accounts this ETH exactly once.
        if (unwrapping) {
            if (msg.sender != weth) revert Unauthorized();
            return;
        }
        _accountETH(msg.sender, msg.value);
        if (entered == 1) _process();
    }

    function _accountETH(address sender, uint256 amount) private {
        uint256 marketing = amount * 3 / 4;
        uint256 buyback = amount - marketing;
        marketingPending += marketing;
        burnPending += buyback;
        totalReceived += amount;
        emit Received(sender, amount, marketing, buyback);
    }

    /// @notice Approve this receiver on WETH, then deposit and attempt processing.
    /// @dev Only pulls caller funds. A failed unwrap leaves WETH queued for process().
    function depositWETHAndProcess(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = IWrappedETH(weth).balanceOf(address(this));
        if (!IWrappedETH(weth).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        if (IWrappedETH(weth).balanceOf(address(this)) - beforeBalance != amount) revert InvalidAmount();
        emit WETHDeposited(msg.sender, amount);
        _attemptWETH();
        _attemptMarketing();
        _attemptBuyback();
    }

    /// @notice Permissionless sweep of direct WETH transfers and retry of queued ETH.
    /// @dev Ordinary ERC20 transfers cannot trigger this; a caller/keeper must call it.
    function process() external nonReentrant { _attemptWETH(); _attemptMarketing(); _attemptBuyback(); }
    function releaseMarketing() external nonReentrant { _attemptMarketing(); }

    function _process() private {
        entered = 2;
        _attemptWETH();
        _attemptMarketing(); // Marketing is always tried before the burn; burns cannot undo it.
        _attemptBuyback();
        entered = 1;
    }

    function _attemptWETH() private {
        if (gasleft() < WETH_GAS + GAS_RESERVE) return;
        try this.unwrapWETH{gas: WETH_GAS}() {} catch { emit WETHDeferred(); }
    }

    /// @dev Self-only boundary prevents an unwrap failure blocking queued ETH payout.
    function unwrapWETH() external {
        if (msg.sender != address(this) || entered != 2) revert Unauthorized();
        uint256 amount = IWrappedETH(weth).balanceOf(address(this));
        if (amount == 0) return;
        uint256 beforeETH = address(this).balance;
        unwrapping = true; // Warm this slot before WETH9's stipend-limited callback.
        IWrappedETH(weth).withdraw(amount);
        unwrapping = false;
        if (address(this).balance - beforeETH != amount
            || IWrappedETH(weth).balanceOf(address(this)) != 0) revert InvalidAmount();
        _accountETH(weth, amount);
        emit WETHUnwrapped(amount);
    }

    function _attemptMarketing() private {
        uint256 amount = marketingPending;
        if (amount == 0 || gasleft() < MARKETING_GAS + GAS_RESERVE) return;
        marketingPending = 0;
        (bool ok,) = marketingWallet.call{value: amount, gas: MARKETING_GAS}("");
        if (ok) {
            totalMarketingPaid += amount;
            emit MarketingPaid(marketingWallet, amount);
        } else {
            marketingPending += amount;
            emit MarketingDeferred(amount);
        }
    }
    function _attemptBuyback() private {
        if (buybacksPaused || burnPending < burnThreshold || gasleft() < GAS_RESERVE + 150_000) return;
        uint256 amount = burnPending < maxBuybackETH ? burnPending : maxBuybackETH;
        uint256 allowance = gasleft() - GAS_RESERVE;
        if (allowance > BUYBACK_GAS) allowance = BUYBACK_GAS;
        try this.executeAutomaticBuyback{gas: allowance}(amount) {} catch { emit BuybackDeferred(amount); }
    }

    /// @dev Self-call boundary rolls back only the buyback if a router, token or output check fails.
    ///      No owner/deployer/caller can choose a different pool or destination.
    function executeAutomaticBuyback(uint256 ethAmount) external {
        if (msg.sender != address(this) || entered != 2) revert Unauthorized();
        if (buybacksPaused) revert BuybacksPaused();
        if (ethAmount < burnThreshold || ethAmount > burnPending || ethAmount > maxBuybackETH) revert InvalidAmount();
        // A taxed nested buy would modify ZYPTO's pending-fee state during its payout routine.
        // Require token-owner exemption, buy into this contract, then transfer to dead.
        if (!token._isExcludedFromFees(address(this))) revert Unauthorized();
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = address(token);
        (, uint256 minimum) = quoteBuyback(ethAmount);
        burnPending -= ethAmount;
        uint256 beforeBalance = token.balanceOf(address(this));
        uint256 beforeDead = token.balanceOf(BURN_ADDRESS);
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: ethAmount}(
            minimum, path, address(this), block.timestamp
        );
        uint256 bought = token.balanceOf(address(this)) - beforeBalance;
        if (bought < minimum) revert InsufficientOutput();
        if (!token.transfer(BURN_ADDRESS, bought)) revert TransferFailed();
        uint256 burned = token.balanceOf(BURN_ADDRESS) - beforeDead;
        if (burned < minimum) revert InsufficientOutput();
        totalBuybackETH += ethAmount;
        totalTokensSentToDead += burned;
        emit BuybackBurned(ethAmount, burned);
    }

    function setBurnThreshold(uint256 threshold) external onlyOwner {
        if (threshold == 0 || threshold > maxBuybackETH) revert InvalidAmount();
        emit BurnThresholdChanged(burnThreshold, threshold);
        burnThreshold = threshold;
    }
    /// @notice Current direct-pair V2 quote and minimum output, in token base units.
    /// @dev This is a same-transaction spot quote, not an oracle, TWAP or MEV protection.
    ///      The reserve timestamp marks the last pool update, not price freshness.
    function quoteBuyback(uint256 ethAmount) public view returns (uint256 quotedTokens, uint256 minimumTokens) {
        if (ethAmount == 0) revert InvalidAmount();
        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        (uint256 reserveIn, uint256 reserveOut) = wethIsToken0
            ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));
        if (reserveIn == 0 || reserveOut == 0) revert InvalidQuote();
        // Uniswap V2's 0.30% pool fee; checked against the immutable router below.
        uint256 amountWithFee = ethAmount * 997;
        quotedTokens = amountWithFee * reserveOut / (reserveIn * 1_000 + amountWithFee);
        if (quotedTokens == 0) revert InvalidQuote();
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = address(token);
        uint256[] memory amounts = router.getAmountsOut(ethAmount, path);
        if (amounts.length != 2 || amounts[0] != ethAmount || amounts[1] != quotedTokens) revert InvalidQuote();
        minimumTokens = quotedTokens * (10_000 - slippageBps) / 10_000;
        if (minimumTokens == 0) revert InvalidQuote();
    }

    /// @notice Maximum spend per attempt and slippage below the current pair quote.
    function setBuybackLimits(uint256 maxETH, uint256 maxSlippageBps) external onlyOwner {
        if (maxETH < burnThreshold || maxSlippageBps > MAX_SLIPPAGE_BPS) revert InvalidAmount();
        maxBuybackETH = maxETH;
        slippageBps = maxSlippageBps;
        emit BuybackLimitsChanged(maxETH, maxSlippageBps);
    }
    function setBuybacksPaused(bool paused) external onlyOwner {
        buybacksPaused = paused;
        emit BuybackPauseChanged(paused);
    }
    /// @notice Ownership is initially copied from ZYPTO; later changes use this two-step flow.
    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0) || nextOwner == address(this)) revert InvalidAddress();
        pendingOwner = nextOwner;
        emit OwnershipTransferStarted(owner, nextOwner);
    }
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @notice Owner can recover ETH while buybacks are paused, including allocated funds.
    /// @dev Spend forced/unaccounted ETH first, then debit pending allocations pro rata.
    ///      This explicitly permits the owner to override the burn commitment in an emergency.
    function emergencyWithdrawETH(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (!buybacksPaused) revert PauseRequired();
        if (to == address(0) || to == address(this)) revert InvalidAddress();
        if (amount == 0 || amount > address(this).balance) revert InvalidAmount();
        uint256 accounted = marketingPending + burnPending;
        uint256 surplus = address(this).balance - accounted;
        uint256 marketingDebit;
        uint256 burnDebit;
        if (amount > surplus) {
            uint256 debit = amount - surplus;
            marketingDebit = debit * marketingPending / accounted;
            burnDebit = debit - marketingDebit;
            marketingPending -= marketingDebit;
            burnPending -= burnDebit;
        }
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit EmergencyETHWithdrawn(to, amount, marketingDebit, burnDebit);
    }

    /// @notice Recover accidentally sent ERC20 tokens. Tokens at the dead address cannot be recovered.
    function emergencyWithdrawToken(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (!buybacksPaused) revert PauseRequired();
        if (asset.code.length == 0 || to == address(0) || to == address(this)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        (bool ok, bytes memory data) = asset.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        emit EmergencyTokenWithdrawn(asset, to, amount);
    }
}

/// @notice Ethereum-mainnet ZYPTO receiver with a fixed pair and configurable quote slippage, never a deployer owner.
contract ZyptoFeeReceiver is FeeReceiverCore {
    constructor(uint256 initialBurnThreshold, address initialPair)
        FeeReceiverCore(0x7A65CB87F596Caf31a4932f074c59c0592bE77D7, initialBurnThreshold, initialPair)
    { require(block.chainid == 1, "Ethereum mainnet only"); }
}
