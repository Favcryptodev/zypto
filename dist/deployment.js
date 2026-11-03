// Trusted build-time configuration. Never read addresses or fees from browser
// storage, form fields, query strings, or window globals.
export const DEPLOYMENT=Object.freeze({
  chainId:1n,
  token:'0x7A65CB87F596Caf31a4932f074c59c0592bE77D7',
  receiver:'0xC4C6B2320Fc2E77d55007dd22daE1f2D70826CE3',
  payout:'0x7fFa6CBe2516B0c15966f0DA27261ffd0d9a8651',
  receiverOwner:'0x86A0985acba4eC2BE144ee23b0147633bE6C0F59',
  router:'0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  weth:'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  pair:'0x1eCb460a532c1D76937BEdbadF7D333DA30255a4',
  receiverCodeHash:'0x1895e0a68d42bf76807dccc14eda5e13d04f47529aa2b622f7693274ee99ed44',
  tokenCodeHash:'0xa37fb58a4bf9ac91dc742f7edbd64ec4196f71bfef030b280de5fa4bdd322f01',
  verifiedBlock:26334323,
  sellLiquidityBps:10n,
  sellReceiverBps:390n,
});
