# Zypto Tax Console

Recovered website application source for the existing Zypto Tax Console. No contract was deployed, and no live website or token settings were changed during this recovery.

## Run locally

Requires Python 3 for a static preview and Node.js 24+ with npm for the original mock transaction test.

```sh
npm ci --ignore-scripts
npm run prepare:vendor
npm test
npm run check
python -m http.server 8080 --directory dist
```

Open http://localhost:8080. The website reads Ethereum public RPC endpoints and can request wallet transactions when a visitor explicitly uses its controls. The test mocks those interactions and sends no transactions.

## Files

- `dist/`: recovered original website application, HTML and CSS.
- `test/transactions.mjs`: recovered original mock transaction test.
- `package.json`, `package-lock.json`: pinned ethers 6.13.5 dependency.
- `scripts/prepare-vendor.mjs`: restores the browser dependency locally.

The original application and test files were copied directly from their Git objects to preserve exact bytes. Private hosting identity and private recovery references are excluded from this public repository.

The original third-party ethers bundle is excluded following an automatic approval rejection concerning embedded provider/API key material. Generated vendor files and `node_modules` remain ignored; the official dependency is installed locally from the lockfile instead.

## Contract recovery and review status

Recovered contract source, tests and artifacts are in [`fee-receiver/`](fee-receiver/). The original unmodified recovery is preserved in Git history; the current version adds WETH ingestion and live quotes from an explicitly validated ZYPTO/WETH pair. The constructor takes only the burn threshold and pair address; slippage starts at 3% internally and remains owner-adjustable within 0–10%. See [`fee-receiver/REVIEW.md`](fee-receiver/REVIEW.md) for verification and limitations.

**Native ETH:** fixed 75% marketing / 25% buy-and-burn budget, with best-effort automatic attempts and queued retries. **WETH:** approve then call `depositWETHAndProcess(amount)` for same-transaction processing attempts. Ordinary direct WETH transfers cannot trigger code; anyone can call `process()` (or a later ETH receipt can trigger a sweep). There is no deployed keeper or promise of autonomous processing after a bare ERC20 transfer.

The modified contract is **undeployed**. No mainnet transaction was submitted. Fresh verification passed compilation, 77 local checks and local-mainnet-fork runs at blocks 26,333,835 and 26,333,837 covering real ZYPTO sells, canonical WETH deposit/sweep, live quotes, and real-router burns. Spot quotes are not an independent price oracle or protection against price manipulation. See the current review and fork report; this is not an independent security audit.

## Validation

`npm test` passed: 10/390 calldata, setup ordering, undeployed/unexempt receiver blocks, owner enforcement, and confirmed-state refresh. `npm run check` passed. These are local checks; no blockchain transactions were sent. A pattern scan found no embedded credentials in the retained application source.
