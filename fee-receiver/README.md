# ZYPTO automatic fee receiver

**Status: explicit immutable pair plus current quote/slippage added (2026-11-03); UNDEPLOYED. Configuration remains 0.1% LP and 3.9% to the fixed 75/25 receiver.**

## Requested behavior

For native ETH sent to this receiver, and WETH after unwrapping:

- 75% is allocated to the marketing wallet that ZYPTO reports at deployment.
- 25% is allocated to buying ZYPTO and sending it to `0x000000000000000000000000000000000000dEaD`.
- Every receipt attempts marketing payout first, then an automatic buyback when the ETH burn allocation reaches its threshold.
- The owner is read from the live token's `owner()` during deployment. The deployer never receives ownership or another privileged role.
- Owner-only emergency withdrawals recover ETH or ERC20 tokens while buybacks are paused.

The agreed sell configuration is `setSellFee(10, 390)`: 10 basis points (0.1%) for liquidity and 390 basis points (3.9%) to this receiver. The receiver's existing 75/25 split is unchanged.

| Destination | Effective share of each taxable sell |
|---|---:|
| ZYPTO liquidity | 0.1% |
| Marketing wallet | 2.925% |
| ZYPTO buy-and-burn budget | 0.975% |
| Total | 4% |

This is a budget allocation, not a promise that exactly 0.975% of tokens sold will be burned: price, AMM fees and price impact determine token output. Buy-derived marketing ETH also uses the same receiver and split. Existing liquidity balances are not reallocated. ETH donations are split the same way.

## Why retain 0.1% liquidity

Verified source: https://etherscan.io/address/0x7a65cb87f596caf31a4932f074c59c0592be77d7#code

The superseded `setSellFee(0, 400)` setting could leave no liquidity tokens after ZYPTO swaps its marketing allocation. ZYPTO then unconditionally attempts a zero-input swap and reverts. Retaining a nonzero LP fee creates a liquidity allocation from taxable sells and avoids relying on liquidity left over from prior buys.

Do not use the old zero-liquidity setting. Historical `artifacts/fork-results.json` records that edge case. The revised test is `npm run test:fork:revised`; it tests actual sells, receiver payments, LP minting and automatic burns with the 10/390 setting on a local mainnet fork. See its report for exact test conditions. Nonzero rates do not promise arbitrary dust-sized manual processing will succeed: integer rounding and AMM minimum amounts still apply.

## Mainnet addresses verified during this task

| Role | Address |
|---|---|
| ZYPTO | `0x7A65CB87F596Caf31a4932f074c59c0592bE77D7` |
| Current token owner / intended initial receiver owner | `0x86A0985acba4eC2BE144ee23b0147633bE6C0F59` |
| Current marketing wallet / fixed payout destination | `0x7fFa6CBe2516B0c15966f0DA27261ffd0d9a8651` |
| Router | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` |
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| Pair | `0x1eCb460a532c1D76937BEdbadF7D333DA30255a4` |

The constructor reads ownership, marketing, router and WETH from ZYPTO. The supplied pair is validated against the router factory and becomes immutable. Re-check these addresses immediately before deployment. If the token's marketing receiver has already been changed, the constructor would copy that newer receiver instead. Subsequent token ownership changes do not automatically change receiver ownership; use its separate two-step ownership transfer.

## Failure isolation and automatic attempts

`receive()` accounts for the full incoming ETH before attempting either action. Marketing is sent with a 40,000-gas cap. A rejected payment remains `marketingPending` and can be retried. The buyback runs through a self-call with a 650,000-gas cap and a reserve for the receiving frame. Any router revert, out-of-gas failure within that subcall, missing exemption, insufficient output or failed token transfer rolls back only the buyback and leaves `burnPending` intact.

Reentrant receipts are accounted without recursively processing. A caller cannot select a swap target, marketing destination or burn destination. A swap can never spend marketing's allocation.

Processing is best-effort. Transactions must provide enough gas to account for receipt. Under low remaining gas, the receiver skips processing and keeps allocations. No Solidity contract can guarantee successful receipt with an arbitrary caller-supplied gas limit (a 2,300-gas `transfer` is not supported). Gas estimators may choose a lower-gas path that queues rather than executes a buyback. The actual ZYPTO router forwards gas using a call. Include adequate gas when testing/operating the integration.

Every later ETH receipt retries, and anyone can call `process()` or `releaseMarketing()`. These are fallback triggers, not a required keeper for the automatic path. Rejected marketing payments can never be forced into a wallet that refuses ETH; the funds stay queued instead.

## Buyback settings

Constructor arguments, in this order (no slippage input is required):

1. `initialBurnThreshold`: positive ETH amount in wei; a suggested starting value is `10000000000000000` (0.01 ETH).
2. `initialPair`: the explicit ZYPTO/WETH Uniswap V2 pair, currently `0x1eCb460a532c1D76937BEdbadF7D333DA30255a4`.

The supplied pair must have deployed code, equal `router.factory().getPair(ZYPTO, WETH)`, report the same factory, and contain the correct sorted ZYPTO/WETH token addresses. The factory must also have code. The immutable mainnet router uses the direct WETH → ZYPTO route through that factory's unique pair, so a different pool cannot be chosen for quoting or execution. There is no pair or router setter. A different arbitrary pair is not accepted simply because it contains ZYPTO.

Initial maximum per buyback is 10 times the threshold. Slippage automatically starts at 300 basis points (3%), set internally by the contract. The owner can change maximum spend and slippage with `setBuybackLimits(maxETH, slippageBps)`. Slippage is capped at 10%; the maximum cannot be below the threshold. `setBurnThreshold` accepts positive values up to that maximum. If increasing it above the maximum, raise the maximum first.

Each attempt reads the selected pair's current reserves and calculates the direct Uniswap V2 output including its 0.30% swap fee and price impact. It requires the immutable router's direct-path quote to match that reserve calculation. The minimum accepted output is the quote multiplied by `(10,000 - slippageBps) / 10,000`, rounded down. `quoteBuyback(ethAmount)` exposes the current quote and minimum for inspection. Empty reserves, zero rounded output/minimum, malformed or inconsistent quotes, and reverted quote calls defer the burn without undoing marketing payout. The reserve timestamp is not treated as an expiry: an idle pool can have valid reserves from an old update.

**No fixed token-per-ETH floor remains. This is a same-transaction spot quote, not an independent oracle, TWAP, fair-price guarantee or MEV protection.** An attacker can move reserves before the transaction; the receiver will then quote that manipulated market, even at zero slippage. Matching the reserve calculation and router quote confirms the pool/calculation, not price fairness. Spend caps and slippage do not make this sandwich-proof. Owner pause and emergency controls remain available.

The token owner must call `excludeFromFees(receiverAddress, true)` before buybacks can execute. The receiver checks this at execution, buys into itself, then transfers the measured amount to the dead address. This avoids a nested taxable purchase mutating ZYPTO's pending-fee state during its own payout routine. If exemption is missing or later removed, burns defer and marketing still processes.

Sending tokens to the dead address is a conventional burn by making tokens inaccessible. It does not reduce ZYPTO's `totalSupply()`; the existing token has no public supply-reducing burn entry point.

## Owner controls and emergency recovery

- `setBuybacksPaused(bool)` pauses automatic burns; receipt and marketing processing remain active.
- `emergencyWithdrawETH(to, amount)` requires paused buybacks. It spends unaccounted/forced ETH first, then debits pending marketing and burn allocations proportionally.
- `emergencyWithdrawToken(asset, to, amount)` requires paused buybacks and recovers tokens held by this receiver.
- `transferOwnership(next)` / `acceptOwnership()` use a two-step change. There is no ownership renunciation function.
- Marketing, token/router/WETH/pair addresses and the 75/25 split are immutable.

Emergency recovery can withdraw queued burn funds as expressly requested. Therefore this is owner-administered, not an irrevocable burn commitment. No function can recover tokens already sent to the dead address. Failed emergency transfers revert atomically without corrupting allocation accounting.

## Build and tests

```sh
npm ci
npm run build
npm run test:all
npm run test:fork:weth
npm run prepare:deployment -- 0.01 0x1eCb460a532c1D76937BEdbadF7D333DA30255a4
```

`ETH_RPC_URL` optionally selects an Ethereum mainnet RPC. The fork tests do not send mainnet transactions. The revised test clears the token fee balance and pending marketing allocation before each test sell, lowers the token swap threshold to exercise payout on each sell, and uses a 0.00001 ETH burn threshold. These are local test-only changes, not live configuration changes. The historical fork test adjusts one local token slot for the isolated zero-liquidity case. The package's test source `test/VerifiedZypto.sol` is the verified source fetched from Etherscan for analysis.

- 21 native-ETH local EVM cases cover ownership, split accounting, triggering, swaps, gas exhaustion, rejected marketing, retries, reentrancy, slippage, exemption, pause, recovery, caps and ownership transfer.
- 13 WETH cases preserve explicit deposits, direct-transfer sweeps, canonical 2,300-gas callbacks, exact accounting, unwrap/transfer failures, reentry, pause and recovery.
- 23 pair/quote cases cover wrong pair/factory/assets, sorted token validation, absent code, bounds, dynamic reserves, quote/route consistency, invalid quotes, slippage edges, old reserve timestamps and ETH/WETH failure isolation. All 57 local contract cases passed for this update.
- 20 deployment-script checks use mocked RPC responses in an isolated temporary directory and never sign or broadcast. They check valid plans, validation failures and stale build rejection.
- The final two-input `test/fork-weth.mjs` run passed at Ethereum block 26,333,835 and deploys only on a local fork. It tests six clean-fee sell cycles, LP minting, marketing, automatic burns, canonical WETH explicit deposits/direct transfers, and deliberate burn failure. `test/fork-revised.mjs` passed the native-ETH subset at block 26,333,837; both use the new constructor and verify pair/quote identity.
- Current local reports are `artifacts/test-results.json`, `artifacts/weth-test-results.json` and `artifacts/pair-test-results.json`. See each fork report's timestamp, block and pricing fields to distinguish current runs from historical results. `artifacts/fork-results.json` retains the historical zero-liquidity finding, not approval to use that configuration. Any receiver address in fork reports exists only on that local fork.

These are implementation tests, not an independent security audit.

## Deployment preparation (no signing)

The preparation script accepts only optional threshold (ETH) and pair address, defaulting to `0.01` and the canonical pair above. It needs no slippage input; the contract starts at 300 basis points (3%). It writes `artifacts/deployment-plan.json` with unsigned creation calldata, both constructor arguments, expected live owner/marketing, immutable addresses and a sample quote/minimum. It never loads a private key, signs or broadcasts. The sample quote is informational only; it is not saved as an on-chain floor.

Preparation requires freshly built matching source/ABI. It verifies chain ID 1, code, factory/pair identity, sorted assets, nonempty reserves and a consistent quote at one block, then rechecks that block's hash. A failed preparation does not replace the previous plan. The current unsigned plan is a snapshot and must be refreshed and reviewed before deployment, particularly if owner or marketing configuration changes.

Deploy **ZyptoFeeReceiver**, not the abstract testing core, using Solidity 0.8.24, optimizer 200 runs, EVM `paris`. The wrapper only deploys on chain ID 1. Source and standard JSON input are included for explorer verification. After deployment, compare all immutable addresses, owner, threshold, cap and slippage against the reviewed plan before any owner activation transaction. All prior fixed-floor and three-argument constructor/calldata versions are obsolete.

## Owner activation sequence

1. Deploy the receiver and verify its owner, original marketing wallet, router, WETH, pair, threshold, maximum spend and slippage. The deployment wallet receives no control.
2. The ZYPTO owner calls `excludeFromFees(receiverAddress, true)` on ZYPTO. The new receiver requires this for automatic burns.
3. The ZYPTO owner calls `setSellFee(10, 390)` on ZYPTO.
4. The ZYPTO owner calls `setMarketingWallet(receiverAddress)` on ZYPTO.

The updated tax console uses 10/390 and blocks switching to an undeployed or non-exempt receiver. The owner can perform exemption through ZYPTO's Etherscan write-contract page. The receiver contract remains undeployed; no real token settings, exemptions or transfers were submitted in this task.

## WETH ingestion update (2026-11-02; UNDEPLOYED)

The fixed 75% marketing / 25% buy-and-burn allocation and existing owner controls are unchanged.

- For an explicit WETH payment, approve the receiver on WETH, then call `depositWETHAndProcess(amount)`. Only the caller's approved balance is pulled. This call attempts unwrapping and the usual marketing-first processing immediately.
- Ordinary `WETH.transfer(receiver, amount)` cannot invoke the receiver. Anyone may subsequently call `process()` to sweep the receiver's direct WETH balance, unwrap and process it. A later native ETH receipt also attempts the sweep when gas is sufficient. **A caller/keeper is needed if no later transaction occurs; the contract cannot wake itself up.** No keeper is deployed or configured here.
- Unwrapping is best-effort in an isolated self-call. A failed unwrap leaves WETH queued without blocking existing native ETH marketing payments. Deposit failure before WETH is accepted (including inadequate allowance or a failed transfer) reverts atomically. Monitor `WETHDeferred`, balances and pending allocations rather than assuming each successful deposit also completed a burn.
- The guarded WETH callback returns without storage writes or events, supporting canonical WETH9's 2,300-gas `transfer`. The outer frame verifies exact ETH proceeds and wrapped-token debit, then accounts once. It never combines accounting from the callback and the outer frame.
- Permissionless callers cannot select the marketing or burn destination. WETH remains owner-recoverable through paused emergency token withdrawal, like other ERC20 assets.
- Underlying original native ETH rules still apply: thresholds, max spend, current quote/slippage, pause, fee exemption, gas and swap failures can defer burns. Marketing recipient receives native ETH, not WETH.

Canonical WETH9 reference: https://github.com/gnosis/canonical-weth/blob/master/contracts/WETH9.sol (withdraw uses ETH transfer; ERC20 transfer does not notify the recipient).

The original WETH update passed its canonical-WETH fork at block 26,328,635. The 2026-11-03 pair/quote update preserves this ingestion behavior and retests it with the new constructor. Use the latest report's timestamp/block to identify the tested revision. No receiver, keeper, live tax configuration or real transaction has been deployed by these local checks.
