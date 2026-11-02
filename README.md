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

The original `zypto-fee-receiver.zip` was located, but **the contract package is not included yet**. Its download helper reached metadata application and failed on Windows because Python's `os.setxattr` is unavailable. The transfer did not install the file. No substitute contract has been reconstructed from conversation text.

The requested receiver-contract review remains pending recovery of the original Solidity source and tests. Website mock tests do not verify the receiver contract. In particular, ordinary WETH ERC20 transfers do not invoke a recipient's ETH `receive()` callback; the original contract must be inspected to establish any separate processing entrypoint or keeper requirement. The intended historical split is 75% tax receiver and 25% buy-and-burn, subject to confirmation against the original contract. Deployment status and contract runtime correctness have not been verified here.

## Validation

`npm test` passed: 10/390 calldata, setup ordering, undeployed/unexempt receiver blocks, owner enforcement, and confirmed-state refresh. `npm run check` passed. These are local checks; no blockchain transactions were sent. A pattern scan found no embedded credentials in the retained application source.
