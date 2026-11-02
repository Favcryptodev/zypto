# Ethereum wallet connection

The public console supports injected Ethereum browser wallets and wallet in-app browsers. It discovers multiple providers through [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963), with a legacy `window.ethereum` fallback, and uses the [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) account, chain and disconnect events.

Connecting requests account access and, when needed, asks the wallet to switch to Ethereum mainnet (chain ID 1). It never requests a signature, approval or transaction as part of connection. The existing owner transaction controls remain separate, with fresh owner/account/network checks, simulation, deployed-receiver and fee-exemption checks, wallet confirmation, and on-chain confirmation handling.

Provider selection and connection state remain in memory. Disconnect clears the page session and listeners; it does not revoke permissions inside the wallet. Account, network and disconnect events invalidate owner state. Stale approvals cannot reconnect after a local disconnect, repeated connection requests are blocked, and connection requests time out with recovery instructions.

QR WalletConnect pairing is not configured. It would require an authorized WalletConnect/Reown project ID and a separate integration; no project ID or persistent credential has been invented.

`npm run prepare:vendor` uses pinned esbuild to generate only the ethers APIs used here. The generated bundle is ignored in Git. Unused hosted-provider integrations are excluded; public reads use the two explicitly configured public RPC endpoints.

## Verification

- `npm test`: wallet discovery, selected provider, account events, chain switching, rejected requests, pending/unsupported/authorization errors, disconnect cleanup, late approvals, duplicate clicks, timeout/empty account handling, and original owner transaction checks.
- `npm run check`: application and wallet module syntax.
- Frontend static audit: no blocking findings.
- Browser: public Ethereum read success, no-wallet recovery, native picker keyboard opening/closing, receiver inline validation, and a narrow layout without horizontal overflow. No wallet extension was available in the test browser; real mobile/hardware wallet approval has not been verified.

The receiver package is undeployed. Direct WETH transfers do not themselves execute receiver code; processing requires a subsequent trigger or processing call as described by the contract documentation. Publishing the console does not deploy the receiver or modify token settings.
