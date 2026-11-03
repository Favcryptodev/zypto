import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

// Isolated mock-RPC tests. No live RPC, signing, broadcast, or project artifact writes.
const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'zypto-preparation-'));
try {
mkdirSync(`${tmp}/artifacts`);mkdirSync(`${tmp}/contracts`);
const source='test source';
writeFileSync(`${tmp}/contracts/ZyptoFeeReceiver.sol`,source);
writeFileSync(`${tmp}/artifacts/standard-input.json`,JSON.stringify({sources:{'contracts/ZyptoFeeReceiver.sol':{content:source}}}));
const currentABI = ['constructor(uint256 initialBurnThreshold,address initialPair)', 'function setBuybackLimits(uint256,uint256)'];
const artifactPath = `${tmp}/artifacts/ZyptoFeeReceiver.json`;
function writeArtifact(abi = currentABI) {
  writeFileSync(artifactPath, JSON.stringify({bytecode: '0x60006000', abi}));
}
writeArtifact();
const mock=`
import {Interface} from ${JSON.stringify(import.meta.resolve('ethers'))};
const iface=new Interface(['function owner() view returns(address)','function _marketingWallet() view returns(address)','function _uniswapV2Router() view returns(address)','function _WETH() view returns(address)','function WETH() view returns(address)','function factory() view returns(address)','function getPair(address,address) view returns(address)','function token0() view returns(address)','function token1() view returns(address)','function getReserves() view returns(uint112,uint112,uint32)','function getAmountsOut(uint256,address[]) view returns(uint256[])']);
const token='0x7a65cb87f596caf31a4932f074c59c0592be77d7',weth='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',pair='0x1ecb460a532c1d76937bedbadf7d333da30255a4',router='0x7a250d5630b4cf539739df2c5dacb4c659f2488d',factory='0x0000000000000000000000000000000000000001';
const mode=process.env.TEST_MODE;let blocks=0;
globalThis.fetch=async(_url,opts)=>{let {method,params}=JSON.parse(opts.body),result;
if(method==='eth_chainId')result=mode==='chain'?'0x2':'0x1';
else if(method==='eth_blockNumber')result='0x100';
else if(method==='eth_getBlockByNumber'){if(params[0]!=='0x100')throw Error('bad block');result={hash:mode==='reorg'&&blocks++?'0xchanged':'0x1234'};}
else if(method==='eth_getCode'){if(params[1]!=='0x100')throw Error('bad block');result=mode==='code'?'0x':'0x6000';}
else if(method==='eth_call'){if(params[1]!=='0x100')throw Error('bad block');const call=iface.parseTransaction({data:params[0].data});let val;
switch(call.name){case 'owner':case '_marketingWallet':val=mode==='owner'?'0x0000000000000000000000000000000000000000':factory;break;case '_uniswapV2Router':val=router;break;case '_WETH':case 'WETH':val=weth;break;case 'factory':val=factory;break;case 'getPair':val=mode==='pair'?factory:pair;break;case 'token0':val=mode==='sort'?weth:token;break;case 'token1':val=mode==='sort'?token:weth;break;case 'getReserves':val=[mode==='reserves'?0n:1000000000000000000000000n,100000000000000000000n,1];break;case 'getAmountsOut':val=[call.args[0],mode==='quote'?1n:call.args[0]*997n*1000000000000000000000000n/(100000000000000000000n*1000n+call.args[0]*997n)];break;}
result=iface.encodeFunctionResult(call.name,call.name==='getReserves'?val:[val]);}else throw Error('Unexpected method '+method);
return {ok:true,json:async()=>({result})};};
`;
writeFileSync(`${tmp}/mock.mjs`,mock);
const pairAddress = '0x1ecb460a532c1d76937bedbadf7d333da30255a4';
const cases = [
  ['valid', [], true],
  ['explicit-pair', ['0.01', pairAddress], true],
  ['threshold-only', ['0.02'], true],
  ...['chain', 'reorg', 'code', 'owner', 'pair', 'sort', 'reserves', 'quote'].map(mode => [mode, [], false]),
  ['negative', ['-1'], false],
  ['obsolete-slippage', ['0.01', pairAddress, '300'], false],
  ['zero-slippage', ['0.01', pairAddress, '0'], false],
  ['max-slippage', ['0.01', pairAddress, '1000'], false]
];
cases.push(
  ['stale-source', [], false],
  ['stale-constructor', [], false],
  ['obsolete-three-argument-constructor', [], false],
  ['stale-setter', [], false],
  ['obsolete-floor', [], false]
);
const expectedErrors = {
  chain: 'Ethereum mainnet required', reorg: 'Snapshot block changed',
  code: 'has no deployed code', owner: 'Invalid live owner',
  pair: 'not the router factory', sort: 'do not match sorted',
  reserves: 'reserves must both be nonzero', quote: 'quote does not match',
  negative: 'Threshold must be positive',
  'obsolete-slippage': 'Usage:', 'zero-slippage': 'Usage:', 'max-slippage': 'Usage:',
  'stale-source': 'Build artifacts are stale',
  'obsolete-three-argument-constructor': 'pair and quote-only receiver API',
  'stale-constructor': 'pair and quote-only receiver API',
  'stale-setter': 'pair and quote-only receiver API',
  'obsolete-floor': 'pair and quote-only receiver API'
};
for (const [mode, args, success] of cases) {
  writeArtifact();
  writeFileSync(`${tmp}/contracts/ZyptoFeeReceiver.sol`, source);
  if (mode === 'stale-source') writeFileSync(`${tmp}/contracts/ZyptoFeeReceiver.sol`, 'new unbuilt source');
  if (mode === 'stale-constructor') writeArtifact(['constructor(uint256,uint256)', currentABI[1]]);
  if (mode === 'obsolete-three-argument-constructor') writeArtifact(['constructor(uint256,address,uint256)', currentABI[1]]);
  if (mode === 'stale-setter') writeArtifact([currentABI[0], 'function setBuybackLimits(uint256,uint256,uint256)']);
  if (mode === 'obsolete-floor') writeArtifact([...currentABI, 'function minTokensPerETH() view returns(uint256)']);
  writeFileSync(`${tmp}/artifacts/deployment-plan.json`, 'SENTINEL');
  const run = spawnSync(process.execPath, [
    '--import', `${tmp}/mock.mjs`, `${root}/scripts/prepare-deployment.mjs`, ...args
  ], {cwd: tmp, env: {...process.env, TEST_MODE: mode}, encoding: 'utf8', timeout: 10000});
  assert.ifError(run.error);
  assert.equal(run.status === 0, success, `${mode}: ${run.stderr}`);
  const plan = readFileSync(`${tmp}/artifacts/deployment-plan.json`, 'utf8');
  if (!success) {
    assert.ok(run.stderr.includes(expectedErrors[mode]), `${mode}: unexpected error: ${run.stderr}`);
    assert.equal(plan, 'SENTINEL', `${mode}: failure changed existing plan`);
  } else {
    const parsed = JSON.parse(plan);
    assert.equal(parsed.constructorArguments.initialPair.toLowerCase(), '0x1ecb460a532c1d76937bedbadf7d333da30255a4');
    assert.equal(parsed.constructorArguments.initialSlippageBps, undefined);
    assert.equal(parsed.initialSlippageBps, '300');
    assert.deepEqual(Object.keys(parsed.constructorArguments), ['initialBurnThreshold', 'initialPair']);
    assert.equal(parsed.sampleQuote.informationalOnly, true);
    assert.equal(parsed.chainId, 1);
    assert.equal(parsed.block, '0x100');
    assert.equal(parsed.sampleQuote.minimumTokensRaw,
      (BigInt(parsed.sampleQuote.quotedTokensRaw) * 9700n / 10000n).toString());
    assert.equal(parsed.optionalBuybackLimits.signature, 'setBuybackLimits(uint256,uint256)');
    assert.ok(parsed.unsignedDeployment.data.startsWith('0x60006000'));
    assert.equal(parsed.unsignedDeployment.data.length, 10 + 64 * 2, 'Exactly two encoded constructor arguments');
  }
  console.log(`PASS ${mode}`);
}
console.log(`${cases.length} deployment-preparation tests passed.`);
} finally {
  rmSync(tmp, {recursive: true, force: true});
}
