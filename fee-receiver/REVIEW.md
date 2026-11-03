# Pair and current-quote update review — 2026-11-03

**UNDEPLOYED.** This update replaces the owner-maintained fixed token-per-ETH floor with a current pair quote and configurable slippage. The constructor now takes `(initialBurnThreshold, initialPair)`; slippage automatically starts at 300 bps (3%) without a deployment input. The prior native ETH/WETH receipt behavior, fixed 75/25 split and owner controls remain unchanged. This scoped implementation review and test run is not an independent security audit.

## Pool and quote binding

The immutable mainnet ZYPTO token supplies immutable router/WETH configuration and the live owner/marketing snapshot. The explicit pair must have code, match `router.factory().getPair(ZYPTO, WETH)`, report that factory, and expose the exact sorted token0/token1 pair. The factory must have code. For the verified canonical Uniswap V2 router/factory, the direct WETH-to-ZYPTO route executes through this same unique pair. Neither the router nor pair can later be replaced.

Every buyback reads current pair reserves, rejects empty reserves, calculates the standard V2 997/1000 output including price impact, and requires the router quote to match exactly. Quote array length/input/output and nonzero output/minimum are checked. Slippage is configurable from 0 through 1,000 bps; `setBuybackLimits(maxETH, slippageBps)` remains owner-only and requires maximum spend at least equal to the threshold. The former fixed floor and its getter/constructor argument are removed.

The reserve timestamp is intentionally not interpreted as stale-oracle data. It marks the last pool update; an idle pool can still have valid reserves. Both quote calculations use the same spot reserves, so their agreement provides no independent fair-price signal. A pre-transaction reserve manipulation or sandwich remains possible even at zero slippage. This is not a TWAP, oracle, or MEV-protected design. Checked arithmetic may revert for astronomically large public quote inputs; realistic funded buyback amounts remain within bounds.

## Receipt and isolation preservation

- Native ETH accounts once, then attempts wrapped-balance sweep, marketing payout and buy-and-burn.
- Explicit WETH deposits pull only caller-approved funds, verify the amount, and attempt unwrap/processing.
- Direct WETH transfers require a later `process()` call or ETH receipt; no keeper is deployed.
- `unwrapWETH()` is self-only under the processing lock. Its isolated frame and warmed callback guard support canonical WETH9's 2,300-gas transfer, verify exact proceeds, and account once. Failed unwrap remains retryable without blocking native marketing.
- Marketing receives 75% rounded down; the remainder goes to the burn budget. Marketing is attempted first. Quote, router, output, token-transfer and gas failures roll back only the buyback. A failed marketing call retains its independent pending balance.
- The receiver must be fee-exempt on ZYPTO. Buys arrive at the receiver and measured tokens are transferred to the dead address. This does not reduce token totalSupply.
- Initial owner is copied from ZYPTO rather than deployer. Later receiver ownership uses two steps. Paused owner emergency recovery can withdraw pending ETH/WETH, so this remains owner-administered rather than an irrevocable burn commitment.

## Verification

Solidity 0.8.24, optimizer 200 runs, EVM paris compiles to a 9,617-byte runtime. The 21 native ETH tests and 13 WETH tests pass after migration, plus 23 new pair/quote cases (57 contract cases total). New cases cover constructor rejection, dynamic reserve prices, old timestamps, malformed/zero/inconsistent quotes, slippage boundaries, same-pair execution and ETH/WETH marketing independence. Deployment preparation has 20 separate isolated mocked-RPC checks, including invalid configuration and stale artifacts.

The final two-input constructor passed the WETH/mainnet fork at block 26,333,835 and the native integration fork at block 26,333,837. The updated real-contract fork suites assert receiver pair and quote identity, then exercise actual ZYPTO sells, LP minting, marketing and nested automatic burns through canonical Uniswap V2 under the existing 650,000-gas buyback cap. WETH integration additionally covers real WETH explicit deposit, direct transfer plus permissionless processing, and idempotent retry. Fork reports record exact run blocks/results and use controlled local threshold/fee-balance adjustments; these are not guarantees for every market state.

Independent source review found no blocking source-level issue. For the verified token path, the preceding router swap updates reserves and releases the pair lock before the receiver payout; fee exemption prevents nested taxable fee processing. Runtime gas sufficiency is established by the fork tests rather than assumed from source review.

## Deployment limitations

Fresh ABI, bytecode and compiler input correspond to the new source. Fresh unsigned preparation validates live owner/marketing and code/pair/factory/reserves/quote at one Ethereum block and checks the block hash for reorgs. The bundled plan is informational and requires refresh/review before any separately authorized deployment. Any prior fixed-floor or three-argument creation calldata is invalid for this version. No signing, broadcast, live token settings, receiver activation, GitHub push or keeper setup occurred in this work.
