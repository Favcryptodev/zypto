# Receiver review — 2026-11-02

Original recovered Solidity is unchanged. This is a scoped code review and local test run, not an independent security audit or deployment approval.

## Main requirement gap: WETH is not processed

`contracts/ZyptoFeeReceiver.sol:97-104` accounts only native ETH through `receive()`. Ordinary WETH ERC20 transfers do not execute that callback. There is no WETH deposit, unwrap, or balance-sweep entrypoint. `process()` (108) retries only existing native-ETH accounting; `weth` is used as the swap path (147-149), not as received funds. Direct WETH remains recoverable only by the owner through paused `emergencyWithdrawToken` (226-233); it is not automatically split or burned. The added `test/weth-gap-review.mjs` demonstrates this with an ordinary ERC20 at the configured wrapped-asset address, not a live WETH fork.

If WETH support is required, design and test an explicit deposit/unwrap or permissionless sweep mechanism separately. An ordinary ERC20 transfer cannot itself notify this receiver. Do not activate this original contract expecting automatic WETH processing.

## Confirmed native-ETH behavior

- Allocation is fixed: marketing gets `floor(msg.value * 3 / 4)`; burn gets the remainder (97-101). This is approximately 75/25, with rounding dust going to burn. It is not a configurable small percentage.
- Every ordinary ETH receipt attempts marketing first, then one buyback if the threshold, pause, gas and fee-exemption conditions allow (111-168). Below threshold or on failure, funds remain queued. `process()` and `releaseMarketing()` are permissionless retries, not timers. A later receipt is required for another automatic attempt; ordinary low-gas sends can queue, and arbitrary insufficient gas can still revert receipt. Forced ETH is not accounted as a donation.
- Marketing destination is immutable and copied from ZYPTO at construction (77-85), not dynamically followed. Owner is copied from the live token owner, never deployer; later ownership changes require this receiver's two-step transfer (190-200).
- Buybacks purchase ZYPTO into the receiver and transfer measured tokens to `0x...dEaD` (156-165). This is dead-address removal from circulation, not a reduction of token `totalSupply()`.
- Self-call failure isolation preserves prior successful marketing payment. Marketing has a 40,000-gas cap; buyback is capped at 650,000 gas with reserve. Reverts queue funds instead of changing their destination. Reentrant receipts are accounted, while nested processing is blocked (68-69, 97-115, 140-141).
- Minimum output is the greater of the spot router quote less slippage and the owner's fixed tokens-per-ETH floor (150-154). Initial slippage is 3%, owner limit 10%. This is not a TWAP/oracle or sandwich-proof mechanism; the owner must maintain the fixed floor. Stale or loose floors permit adverse execution, overly strict floors defer burning.
- Owner can pause burns and withdraw even allocated ETH while paused (205-223), or recover ERC20s (226-233). Thus this is administratively recoverable, not an irrevocable burn guarantee. Public callers cannot choose a payout target or execute the buyback self-call directly.

## Historical settings and activation cautions

Original README records a tested configuration of 0.1% liquidity and 3.9% receiver, whose 75/25 split gives 2.925% marketing and 0.975% buy-and-burn budget. Do not restore the superseded zero-liquidity setting; the token's upstream payout can revert. The receiver must be deployed, verified and fee-exempt before activation. Bundled unsigned deployment calldata and price floor are historical examples and must be refreshed/reviewed, not blindly broadcast. No live owner, balances, settings, or deployment status were re-queried in this review.

## Verification

- `npm ci --ignore-scripts --no-audit --no-fund` installed pinned dependencies.
- `npm run build` passed with Solidity 0.8.24; runtime size 7,062 bytes.
- `npm test` passed all 21 original local EVM tests, including reverted/gas-exhausting swaps, rejected marketing, reentrancy, output limits, exemption, emergency accounting and ownership.
- Mainnet-fork reports are original historical artifacts; fork tests were not rerun during this review. No mainnet transactions or deployment were submitted.
- Rebuilt artifacts and original test report matched the recovered archive byte-for-byte. No original project file was altered. Dependency directories, private hosting identity, credentials and recovery identifiers are excluded from publication.

Run the additional receipt-gap regression with `node test/weth-gap-review.mjs` from this directory.
