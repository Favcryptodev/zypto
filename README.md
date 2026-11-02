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

The original contract package is now recovered in [`fee-receiver/`](fee-receiver/), including unmodified Solidity source, tests, build scripts, compiler artifacts and historical fork results. See [`fee-receiver/REVIEW.md`](fee-receiver/REVIEW.md) for the current review and limitations.

**Native ETH:** fixed 75% marketing / 25% buy-and-burn budget with best-effort automatic attempts and queued retries. **Direct WETH transfers are not processed**, even by `process()`; WETH support requires a separately designed change. The receiver is not deployed by this recovery, and no mainnet transactions were submitted. Original historical documentation says it was undeployed at handoff; current onchain status was not re-queried.

Fresh local verification passed Solidity compilation, all 21 original EVM tests and an additional WETH-like ERC20 receipt-gap regression. Original mainnet-fork reports are historical, not a fresh run or an independent security audit.

## Validation

`npm test` passed: 10/390 calldata, setup ordering, undeployed/unexempt receiver blocks, owner enforcement, and confirmed-state refresh. `npm run check` passed. These are local checks; no blockchain transactions were sent. A pattern scan found no embedded credentials in the retained application source.
