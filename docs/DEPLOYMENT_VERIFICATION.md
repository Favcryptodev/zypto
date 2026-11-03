# Deployed receiver verification

Receiver: `0xC4C6B2320Fc2E77d55007dd22daE1f2D70826CE3`, Ethereum mainnet.

Two independent public Ethereum RPC endpoints returned the same state and code at block **26,334,323**, hash `0xde244b314249f84bde8b45f4c810a198ea34aeb8ce92ee3965805f8529fd837f`.

| Property | Verified value |
|---|---|
| Receiver runtime | 15,049 bytes |
| Receiver runtime keccak256 | `0x1895e0a68d42bf76807dccc14eda5e13d04f47529aa2b622f7693274ee99ed44` |
| Token runtime keccak256 | `0xa37fb58a4bf9ac91dc742f7edbd64ec4196f71bfef030b280de5fa4bdd322f01` |
| Token | `0x7A65CB87F596Caf31a4932f074c59c0592bE77D7` |
| Token owner and receiver owner at verification | `0x86A0985acba4eC2BE144ee23b0147633bE6C0F59` |
| Immutable marketing payout | `0x7fFa6CBe2516B0c15966f0DA27261ffd0d9a8651` |
| Router | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` |
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| Immutable pair | `0x1eCb460a532c1D76937BEdbadF7D333DA30255a4` |
| Threshold / maximum buyback | 0.01 ETH / 0.1 ETH |
| Slippage / paused | 300 bps (3%) / false |

The receiver source from repository commit `719bc82cb2cfb511a8560d255b654eb304dbab77` was compiled with Solidity `0.8.24+commit.e11b9ed9`, optimizer **off**, EVM **Shanghai**. Its executable runtime matches the deployed executable after normalizing compiler-reported immutable locations and excluding Solidity's trailing metadata. Metadata is not identical, so this is not a claim of an exact metadata-inclusive artifact match or explorer verification. The repository's earlier optimized Paris artifact is a different build (9,617 bytes). The application pins the complete actual on-chain code hash, not that historical artifact.

The immutable getter values above were separately checked on-chain. Token source confirms `excludeFromFees`, `setSellFee`, and `setMarketingWallet` are owner-only, sell fees are basis points over 10,000, and these setters do not modify buy-fee fields. Read-only `eth_call` simulations from the live owner succeeded for all three intended calls.

At verification, ZYPTO still had 100/300 sell basis points (1%/3%, total 4%), buy fees 0/0, the original marketing destination above, and receiver fee exemption false. The UI re-reads current state; this snapshot does not assert activation has occurred.

## Why exemption is necessary

The receiver's `executeAutomaticBuyback` explicitly reverts unless `token._isExcludedFromFees(address(this))` is true. Current zero buy fees do not remove that requirement. A local fork of the **existing deployed runtime**, not a newly compiled replacement, confirmed:

- With exemption false and buy fees 0/0, a 0.04 ETH test receipt paid 0.03 ETH marketing and queued 0.01 ETH for buyback; no buyback occurred. Pre-existing queued marketing/WETH was settled locally before isolating this receipt.
- The actual application flow then confirmed exemption, 10/390 sell fees and the fixed marketing receiver, in order. Buy fee fields stayed 0/0.
- A subsequent local processing call executed the queued buyback and increased tokens at the dead address.

All writes were confined to an in-process Ganache fork pinned at the fresh mainnet block recorded in its report. Its upstream transport explicitly allowed read methods only. No private key or mainnet transaction was used. See `evidence/deployed-fork-results.json` for gas estimates and measured results.

Historical receiver README/artifact records marked UNDEPLOYED describe their earlier preparation runs; this document records the subsequently observed deployment. Contract source was not changed by the website update.
