// Read-only: creates unsigned deployment calldata. Never loads a key or sends a transaction.
// Usage: npm run prepare:deployment -- [thresholdETH] [pairAddress]
import {Interface, ContractFactory, parseEther, getAddress, ZeroAddress, MaxUint256, keccak256} from 'ethers';
import {readFileSync, writeFileSync, renameSync} from 'node:fs';

const rpc = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const TOKEN = getAddress('0x7a65cb87f596caf31a4932f074c59c0592be77d7');
const EXPECTED_ROUTER = getAddress('0x7a250d5630b4cf539739df2c5dacb4c659f2488d');
const EXPECTED_WETH = getAddress('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
const DEFAULT_PAIR = getAddress('0x1ecb460a532c1d76937bedbadf7d333da30255a4');
const threshold = parseEther(process.argv[2] ?? '0.01');
const pair = getAddress(process.argv[3] ?? DEFAULT_PAIR);
if (process.argv.length > 4) throw Error('Usage: prepare-deployment.mjs [thresholdETH] [pairAddress]');
if (threshold <= 0n || threshold > MaxUint256 / 10n) throw Error('Threshold must be positive and threshold * 10 must fit uint256');
if (pair === ZeroAddress) throw Error('Pair must not be the zero address');
const slippageBps = 300n; // Built-in receiver default; not a deployment input.
const maxETH = threshold * 10n;

// Refuse obsolete constructor artifacts or builds for different source. Build first.
const artifact = JSON.parse(readFileSync('artifacts/ZyptoFeeReceiver.json', 'utf8'));
const buildInput = JSON.parse(readFileSync('artifacts/standard-input.json', 'utf8'));
if (buildInput.sources?.['contracts/ZyptoFeeReceiver.sol']?.content !== readFileSync('contracts/ZyptoFeeReceiver.sol', 'utf8')) {
  throw Error('Build artifacts are stale. Run npm run build before preparing deployment.');
}
const receiverInterface = new Interface(artifact.abi);
if (receiverInterface.deploy.inputs.map(input => input.type).join(',') !== 'uint256,address'
    || !receiverInterface.hasFunction('setBuybackLimits(uint256,uint256)')
    || receiverInterface.hasFunction('minTokensPerETH()')) {
  throw Error('Artifacts must use the pair and quote-only receiver API. Run npm run build.');
}
if (!/^0x[0-9a-f]+$/i.test(artifact.bytecode) || artifact.bytecode.length <= 2) throw Error('Missing deployment bytecode');

let requestId = 0;
async function request(method, params = []) {
  const response = await fetch(rpc, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: ++requestId, method, params}),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
  const json = await response.json();
  if (json.error) throw Error(json.error.message);
  if (json.result === undefined || json.result === null) throw Error(`RPC returned no result for ${method}`);
  return json.result;
}
if (BigInt(await request('eth_chainId')) !== 1n) throw Error('Ethereum mainnet required');
const block = await request('eth_blockNumber');
const snapshot = await request('eth_getBlockByNumber', [block, false]);
const iface = new Interface([
  'function owner() view returns(address)',
  'function _marketingWallet() view returns(address)',
  'function _uniswapV2Router() view returns(address)',
  'function _WETH() view returns(address)',
  'function WETH() view returns(address)',
  'function factory() view returns(address)',
  'function getPair(address,address) view returns(address)',
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function getReserves() view returns(uint112,uint112,uint32)',
  'function getAmountsOut(uint256,address[]) view returns(uint256[])',
  'function setSellFee(uint256,uint256)'
]);
async function read(to, name, args = []) {
  return iface.decodeFunctionResult(name, await request('eth_call', [{to, data: iface.encodeFunctionData(name, args)}, block]));
}
async function addressRead(to, name, args = []) { return getAddress((await read(to, name, args))[0]); }
async function requireCode(address, label) {
  if (address === ZeroAddress || !/^0x[0-9a-f]+$/i.test(await request('eth_getCode', [address, block]))) {
    throw Error(`${label} has no deployed code at snapshot block`);
  }
}
await requireCode(TOKEN, 'ZYPTO');
const [owner, marketing, router, weth] = await Promise.all(
  ['owner', '_marketingWallet', '_uniswapV2Router', '_WETH'].map(name => addressRead(TOKEN, name))
);
if (owner === ZeroAddress || marketing === ZeroAddress || marketing === TOKEN) throw Error('Invalid live owner or marketing wallet');
if (router !== EXPECTED_ROUTER || weth !== EXPECTED_WETH) throw Error('Live token router/WETH differ from reviewed mainnet addresses');
await Promise.all([requireCode(router, 'Router'), requireCode(weth, 'WETH'), requireCode(pair, 'Pair')]);
const [routerWETH, factory, pairFactory, token0, token1] = await Promise.all([
  addressRead(router, 'WETH'), addressRead(router, 'factory'), addressRead(pair, 'factory'),
  addressRead(pair, 'token0'), addressRead(pair, 'token1')
]);
if (routerWETH !== weth) throw Error('Router WETH does not match token WETH');
await requireCode(factory, 'Factory');
if (factory !== pairFactory) throw Error('Selected pair does not belong to the immutable router factory');
if (await addressRead(factory, 'getPair', [TOKEN, weth]) !== pair) throw Error('Selected pair is not the router factory ZYPTO/WETH pair');
const [expected0, expected1] = BigInt(TOKEN) < BigInt(weth) ? [TOKEN, weth] : [weth, TOKEN];
if (token0 !== expected0 || token1 !== expected1) throw Error('Pair token0/token1 do not match sorted ZYPTO/WETH');
const reserves = await read(pair, 'getReserves');
if (reserves[0] === 0n || reserves[1] === 0n) throw Error('Pair reserves must both be nonzero');
const quote = (await read(router, 'getAmountsOut', [maxETH, [weth, TOKEN]]))[0];
if (quote.length !== 2 || quote[0] !== maxETH || quote[1] === 0n) throw Error('Router returned an invalid current quote');
// Verify the quote is from this direct Uniswap V2 pair, including its 0.30% swap fee.
const [reserveIn, reserveOut] = token0 === weth ? [reserves[0], reserves[1]] : [reserves[1], reserves[0]];
const amountWithFee = maxETH * 997n;
if (amountWithFee > MaxUint256 || amountWithFee * reserveOut > MaxUint256
    || reserveIn * 1000n + amountWithFee > MaxUint256) throw Error('Maximum buyback exceeds receiver quote arithmetic bounds');
const expectedQuote = amountWithFee * reserveOut / (reserveIn * 1000n + amountWithFee);
if (quote[1] !== expectedQuote) throw Error('Router quote does not match selected pair reserves');
if (quote[1] > MaxUint256 / 10000n) throw Error('Quote exceeds receiver arithmetic bounds');
const sampleMinimum = quote[1] * (10000n - slippageBps) / 10000n;
if (sampleMinimum === 0n) throw Error('Quote-derived minimum rounds down to zero');
// Same numbered block throughout; abort rather than publish a plan spanning a reorg.
if ((await request('eth_getBlockByNumber', [block, false])).hash !== snapshot.hash) throw Error('Snapshot block changed during preparation; retry');
const deploy = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(threshold, pair);
const plan = {
  status: 'UNDEPLOYED_UNSIGNED_REQUIRES_REVIEW',
  preparedAt: new Date().toISOString(), chainId: 1, block, blockHash: snapshot.hash,
  token: TOKEN, expectedOwner: owner, expectedMarketing: marketing, router, weth, pair, factory,
  pairSnapshot: {token0, token1, reserve0: reserves[0].toString(), reserve1: reserves[1].toString(), reserveTimestamp: reserves[2].toString()},
  constructorArguments: {initialBurnThreshold: threshold.toString(), initialPair: pair},
  initialMaxBuybackETH: maxETH.toString(),
  initialSlippageBps: slippageBps.toString(),
  sampleQuote: {
    informationalOnly: true, amountInWei: maxETH.toString(), quotedTokensRaw: quote[1].toString(),
    minimumTokensRaw: sampleMinimum.toString(), slippageBps: slippageBps.toString(),
    note: 'Snapshot illustration only. Each buyback fetches a fresh spot quote and applies slippage. No fixed output floor, independent oracle, TWAP, or MEV protection.'
  },
  deploymentBytecodeHash: keccak256(artifact.bytecode),
  unsignedDeployment: {chainId: 1, value: '0x0', data: deploy.data},
  optionalBuybackLimits: {
    signature: 'setBuybackLimits(uint256,uint256)', maxETH: maxETH.toString(), slippageBps: slippageBps.toString(),
    calldata: receiverInterface.encodeFunctionData('setBuybackLimits(uint256,uint256)', [maxETH, slippageBps]),
    note: 'Owner-only configuration example using the initial values; no transaction is sent.'
  },
  recommendedSellFees: {liquidityBps: 10, receiverBps: 390, calldata: iface.encodeFunctionData('setSellFee', [10, 390])},
  effectiveSellAllocationPercent: {liquidity: 0.1, marketing: 2.925, buybackBurn: 0.975},
  warning: 'Review live owner and marketing recipient, all immutable addresses, threshold, cap and slippage immediately before deployment. The pair is fixed and must match the immutable router factory. Spot quotes can be manipulated; slippage is not a fair-price guarantee or MEV protection. No fixed output floor remains. Use setSellFee(10,390). The token owner must fee-exempt the receiver before switching the marketing wallet. This script never signs or broadcasts.'
};
// Replace the plan only after every check passes, avoiding partially written calldata.
const planPath = 'artifacts/deployment-plan.json';
const temporaryPath = `${planPath}.${process.pid}.tmp`;
writeFileSync(temporaryPath, JSON.stringify(plan, null, 2) + '\n');
renameSync(temporaryPath, planPath);
console.log(JSON.stringify({...plan, unsignedDeployment: `Written to ${planPath}`}, null, 2));
