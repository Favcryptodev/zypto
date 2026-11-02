# WETH ingestion update review — 2026-11-02

**UNDEPLOYED.** The original receiver was native-ETH-only. This update adds WETH ingestion without changing the fixed 75/25 split or immutable token/router/marketing configuration. The original recovery commit preserves prior source and historical evidence. This is a scoped code review and local test run, not an independent security audit.

## Receipt paths

- Native ETH: account once and attempt wrapped-balance sweep, marketing payout, then buy-and-burn.
- Explicit WETH: `approve` followed by `depositWETHAndProcess(amount)` pulls only caller funds, verifies the received amount, and attempts unwrapping/processing.
- Direct WETH transfer: does not call this contract. Anyone can call `process()` afterward; a later ETH receipt can also sweep. A keeper/caller is required if no further transaction occurs. No automation service is included.

`unwrapWETH()` is self-only while the processing lock is held. Its bounded external-call frame isolates unwrap failure from existing ETH payout. A warmed unwrap guard plus trusted WETH sender identifies the stipend-limited callback, which returns without accounting. The outer frame checks exact native balance increase and zero residual WETH before allocating once. Failed/short unwrap rolls the isolated frame back; funds remain wrapped and retryable. Reentry into deposit/process is rejected.

## Preserved constraints

75% rounded down goes to marketing; the remainder goes to the burn budget. Marketing is attempted first. Failed marketing stays queued, while buyback failures independently roll back. Buybacks remain threshold/cap/gas/fee-exemption/pause dependent. The minimum is the larger of a spot quote less owner-bounded slippage and an owner-maintained fixed output floor; this is not a TWAP or sandwich-proof design. A stale floor can permit unfavorable execution or defer burns.

Burns transfer measured bought tokens to the dead address; token totalSupply is not reduced. Initial ownership is copied from ZYPTO rather than deployer; later ownership requires two steps. The marketing wallet is an immutable deployment-time snapshot. Owner emergency recovery while paused includes pending ETH and WETH, so funds are administratively recoverable rather than an irrevocable burn guarantee.

## Verification and deployment limits

The final source compiles with Solidity 0.8.24 to an 8,731-byte runtime. All 21 original native-ETH local tests passed; the dedicated WETH suite additionally covers the new receipt paths. The WETH mock uses canonical WETH9-style 2,300-gas transfer and additionally tests reverting/short unwrap, failed transferFrom and reentry. Historical fork reports are retained and cover the original implementation. A fresh local Ethereum fork at block 26,328,635 also passed: six actual ZYPTO sells with LP minting, marketing and automatic burns; canonical WETH explicit deposit and real-router burn; direct canonical WETH transfer followed by permissionless processing and idempotent retry; and a deliberate burn failure that preserved marketing and the sell. See `artifacts/weth-fork-results.json` and `test/fork-weth.mjs`. These controlled tests lower thresholds and clear fee balances on the local fork; they are not a guarantee for all market states. No real transactions, deployment, receiver activation or keeper setup occurred.

The old deployment plan is explicitly invalidated. Fresh preparation and review are required before separately authorized deployment. Regenerated ABI/bytecode/standard input correspond to the updated source. Dependencies are pinned; installed vendor directories and credentials are not published.

Independent second-agent source review found no remaining blocker for canonical WETH9. The unwrap callback rejects unexpected senders while the unwrap guard is active.
