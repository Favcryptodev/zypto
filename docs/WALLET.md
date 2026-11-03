# Ethereum owner setup

The fixed deployed receiver is `0xC4C6B2320Fc2E77d55007dd22daE1f2D70826CE3`. Trusted build-time addresses, code hashes and the 10/390 sell-fee plan live in `dist/deployment.js`; no address or fee is taken from a form, URL, browser storage or window global.

Public Ethereum reads and injected wallet discovery remain available. Connection uses EIP-6963 with a legacy EIP-1193 fallback. It requests account access and, if needed, a switch to Ethereum mainnet, but never signs or sends merely by connecting. QR WalletConnect pairing is not configured; no project ID or persistent credential was invented.

## Owner flow

The application verifies chain ID 1, both deployed code hashes, receiver immutable token/payout/router/WETH/pair, receiver ownership and unpaused buybacks. It reads the current token owner and fees at one block. Contract or destination mismatches fail closed. Unexpected marketing destinations are blocked for review.

The connected token owner reviews these calls, in order, skipping satisfied settings:

1. ZYPTO `excludeFromFees(fixedReceiver, true)`.
2. ZYPTO `setSellFee(10, 390)` — 0.1% liquidity, 3.9% receiver, total 4%.
3. ZYPTO `setMarketingWallet(fixedReceiver)`.

**Exemption is required by the deployed receiver's explicit guard even when ZYPTO buy fees are 0%.** It is not an ERC20 spending allowance. The app sends no `approve`, WETH deposit, processing or receiver-admin transaction. No buy-fee setter is exposed or called. The receiver's immutable 75% payout destination is shown alongside its fixed address; the 25% buyback allocation and existing spend/slippage behavior are unchanged.

Each step first opens an inline review with exact from/to addresses, function arguments, calldata, chain, 0 ETH value, gas limit and maximum estimated ETH network fee. The app simulates via `eth_call`, estimates gas with a 20% buffer, checks pending ETH balance, and supports EIP-1559 caps or legacy gas pricing. Review expires after two minutes. Before requesting the wallet transaction it rechecks identity, code/state, prerequisites, unchanged buy fees, balance and gas; an increase requires a new review.

Only a separate **Confirm in wallet** click invokes the wallet's transaction request. There is no automatic batch or next-step submission. A successful receipt with one Ethereum confirmation is checked against the exact reviewed from/to/data/value/chain before fresh setting and buy-fee verification. Rejection or failure stops. A missing/uncertain wallet response or confirmation timeout locks further writes; a known hash can be checked using Refresh/Check transaction. If no hash was returned, inspect wallet activity before reloading or submitting anything else. The page must not be used to blindly retry uncertain transactions.

Account, network and disconnect events invalidate prepared reviews. Transaction confirmation monitoring uses the public Ethereum provider even if the wallet changes networks. Disconnect clears only the page session, not wallet permissions. No private key is requested, saved or handled.

## Validation

- `npm test`: 33 wallet/setup tests covering exact calldata/order, skipped states, wrong chain/owner/code, rejection, reverted receipts, uncertain outcomes, duplicate clicks, gas/ETH handling, account changes, expiry, cancellation and buy-fee preservation.
- `npm run check`: application, wallet, deployment and setup syntax.
- Local fork of the exact deployed receiver and token: all three calls executed through the application's adapter/flow, receipts and settings verified, buy fees remained 0/0. The upstream mainnet transport allowed reads only; all test writes were in-process Ganache transactions.
- Browser checks cover read-only verification, missing-wallet behavior, native picker, fixed addresses, accessible review structure and narrow layout. The test browser has no real wallet extension; real hardware/mobile wallet confirmation remains for the token owner.

See `DEPLOYMENT_VERIFICATION.md` and `evidence/` for source/runtime checks and local fork evidence. These checks are not an independent security audit. Spot-quoted buybacks remain exposed to price manipulation/MEV; direct WETH transfers require a later processing trigger. Publishing this UI does not execute any mainnet setup transaction.
