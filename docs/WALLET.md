# Ethereum wallet connection

The public console supports injected Ethereum browser wallets and wallet in-app browsers. It discovers multiple providers through [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963), with a legacy `window.ethereum` fallback, and uses the [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) account, chain and disconnect events.

Connecting requests account access and, when needed, asks the wallet to switch to Ethereum mainnet (chain ID 1). It never requests a signature, approval or transaction. This release is read-only for all accounts, including the verified token owner. The transaction execution flow has been removed; the application ABI contains view functions only.

Provider selection and connection state remain in memory. Disconnect clears the page session and listeners; it does not revoke permissions inside the wallet. Account, network and disconnect events invalidate owner state. Stale connection approvals cannot reconnect after a local disconnect, repeated connection requests are blocked, and connection requests time out with recovery instructions.

The noneditable receiver display reads **To be deployed**, from immutable version-controlled `dist/deployment.js`. No user-entered address, query/hash value, browser storage or window global can supply a receiver. The disabled **Update** button references a persistent explanation. Its action handler also denies all actions, even when called directly or when disabled DOM state is altered. No signing, approval, processing, fee update or receiver update can be requested from this release. A future activation must ship a reviewed application release with the verified deployed receiver supplied centrally; it is not enabled by a browser setting.

QR WalletConnect pairing is not configured. It would require an authorized WalletConnect/Reown project ID and a separate integration; no project ID or persistent credential has been invented.

`npm run prepare:vendor` uses pinned esbuild to generate only the ethers APIs used here. The generated bundle is ignored in Git. Unused hosted-provider integrations are excluded; public reads use the two explicitly configured public RPC endpoints.

## Verification

- `npm test`: wallet discovery, selected provider, account events, chain switching, rejected requests, pending/unsupported/authorization errors, disconnect cleanup, late approvals, duplicate clicks and timeout/empty account handling. Regression coverage verifies the undeployed lock against a connected token owner, direct action calls, altered disabled state, injected old address fields, stale browser settings and deep links, with zero signer or financial calls.
- `npm run check`: application and wallet module syntax.
- Frontend static audit: no blocking findings.
- Browser verification covers public reads, wallet controls, the noneditable receiver display and disabled Update explanation, keyboard access and narrow layout. No wallet extension was available in the test browser; real mobile/hardware wallet approval has not been verified.

The receiver package is undeployed. Direct WETH transfers do not themselves execute receiver code; processing requires a subsequent trigger or processing call as described by the contract documentation. Publishing the console does not deploy the receiver or modify token settings.
