import ganache from 'ganache';
import solc from 'solc';
import {BrowserProvider,Contract,ContractFactory,Interface,parseEther as eth,toBeHex,zeroPadValue,keccak256,concat} from 'ethers';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const RPC=process.env.ETH_RPC_URL||'https://ethereum-rpc.publicnode.com';
const TOKEN='0x7a65cb87f596caf31a4932f074c59c0592be77d7';
async function remote(method,params=[]){const r=await fetch(RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(j.error)throw Object.assign(Error(j.error.message),j.error);return j.result;}
const block=await remote('eth_blockNumber');console.log('Remote block',block);
const iface=new Interface(['function owner() view returns(address)']);
const OWNER=iface.decodeFunctionResult('owner',await remote('eth_call',[{to:TOKEN,data:iface.encodeFunctionData('owner')},block]))[0];
console.log('Creating local fork',OWNER);
const g=ganache.provider({fork:{blockNumber:Number(BigInt(block)),provider:{request:({method,params})=>remote(method,params)}},chain:{chainId:1},wallet:{unlockedAccounts:[OWNER]},logging:{quiet:true}});
const p=new BrowserProvider(g);p.pollingInterval=50;
const abi=['function owner() view returns(address)','function _marketingWallet() view returns(address)','function _uniswapV2Router() view returns(address)','function _uniswapV2Pair() view returns(address)','function _WETH() view returns(address)','function _swapTokensAtAmount() view returns(uint256)','function _pendingMarketingValue() view returns(uint256)','function _sellFeeLiquidity() view returns(uint256)','function _sellFeeMarketing() view returns(uint256)','function balanceOf(address) view returns(uint256)','function setSellFee(uint256,uint256)','function setSwapAmont(uint256)','function setMarketingWallet(address)','function excludeFromFees(address,bool)','function approve(address,uint256) returns(bool)','function swapAndLiquifyNow()'];
const results=[];
try{
console.log('Funding fork owner');await g.request({method:'evm_setAccountBalance',params:[OWNER,toBeHex(eth('10'))]});
console.log('Fork account ready');const owner=await p.getSigner(OWNER),deployer=await p.getSigner(0),seller=await p.getSigner(1);const sellerAddress=await seller.getAddress();
const t=new Contract(TOKEN,abi,owner),weth=await t._WETH(),routerAddress=await t._uniswapV2Router(),marketing=await t._marketingWallet(),pair=await t._uniswapV2Pair();
const originalThreshold=await t._swapTokensAtAmount();console.log('Read token configuration');
const router=new Contract(routerAddress,['function getAmountsOut(uint256,address[]) view returns(uint256[])','function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256) payable','function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)'],seller);
const deadline=()=>Math.floor(Date.now()/1000)+86400;
console.log('Buying test seller tokens');await (await router.swapExactETHForTokensSupportingFeeOnTransferTokens(0,[weth,TOKEN],sellerAddress,deadline(),{value:eth('1'),gasLimit:2000000})).wait();
console.log('Seller funded');const quote=await router.getAmountsOut(eth('.01'),[weth,TOKEN]);const floor=quote[1]*100n*90n/100n;
const artifact=JSON.parse(readFileSync('artifacts/ZyptoFeeReceiver.json'));const c=await new ContractFactory(artifact.abi,artifact.bytecode,deployer).deploy(eth('.00001'),floor);await c.waitForDeployment();console.log('Receiver deployed locally');
assert.equal(await c.owner(),OWNER);assert.equal(await c.marketingWallet(),marketing);
await (await t.excludeFromFees(c.target,true)).wait();await (await t.setSellFee(10,390)).wait();await (await t.setMarketingWallet(c.target)).wait();
assert.equal(await t._sellFeeLiquidity(),10n);assert.equal(await t._sellFeeMarketing(),390n);
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'VerifiedZypto.sol':{content:readFileSync('test/VerifiedZypto.sol','utf8')}},settings:{outputSelection:{'*':{'*':['storageLayout']}}}})));
const slots=compiled.contracts['VerifiedZypto.sol'].ZyptoToken.storageLayout.storage;
const pendingSlot=zeroPadValue(toBeHex(BigInt(slots.find(x=>x.label==='_pendingMarketingValue').slot)),32);
const balanceSlot=keccak256(concat([zeroPadValue(TOKEN,32),zeroPadValue(toBeHex(BigInt(slots.find(x=>x.label==='_balances').slot)),32)]));
async function cleanFees(){await g.request({method:'evm_setAccountStorageAt',params:[TOKEN,balanceSlot,zeroPadValue('0x00',32)]});await g.request({method:'evm_setAccountStorageAt',params:[TOKEN,pendingSlot,zeroPadValue('0x00',32)]});}
await cleanFees();
const sellerBalance=await t.balanceOf(sellerAddress);const sellAmount=sellerBalance/12n;const testThreshold=sellAmount*400n/10000n/2n;
await (await t.setSwapAmont(testThreshold)).wait();await (await t.connect(seller).approve(routerAddress,sellerBalance)).wait();
const lp=new Contract(pair,['function balanceOf(address) view returns(uint256)'],p);
console.log('Fork block',Number(BigInt(block)),'live owner',OWNER);
for(let i=0;i<6;i++){
 await cleanFees();assert.equal(await t.balanceOf(TOKEN),0n,'each sell begins without leftover fee tokens');
 const beforeReceived=await c.totalReceived(),beforeLP=await lp.balanceOf(OWNER),beforeDead=await t.balanceOf(await c.BURN_ADDRESS());
 await (await router.swapExactTokensForETHSupportingFeeOnTransferTokens(sellAmount,0,[TOKEN,weth],sellerAddress,deadline(),{gasLimit:3000000})).wait();
 assert.ok(await c.totalReceived()>beforeReceived,'receiver gets payout');assert.ok(await lp.balanceOf(OWNER)>beforeLP,'LP is minted');assert.ok(await t.balanceOf(await c.BURN_ADDRESS())>beforeDead,'automatic burn executes');assert.equal(await c.marketingPending(),0n,'marketing paid');
 results.push({cycle:i+1,sellSucceeded:true,liquidityMinted:true,marketingPaid:true,automaticBurn:true});console.log('PASS clean-fee sell cycle',i+1);
}
// Remove exemption to deliberately fail the automatic burn; the enclosing sell and marketing must survive.
await (await t.excludeFromFees(c.target,false)).wait();const beforeReceived=await c.totalReceived(),beforeMarketing=await c.totalMarketingPaid(),beforeBurnPending=await c.burnPending();
await (await router.swapExactTokensForETHSupportingFeeOnTransferTokens(sellAmount,0,[TOKEN,weth],sellerAddress,deadline(),{gasLimit:3000000})).wait();
assert.ok(await c.totalReceived()>beforeReceived);assert.ok(await c.totalMarketingPaid()>beforeMarketing);assert.ok(await c.burnPending()>beforeBurnPending);console.log('PASS failed automatic burn does not revert sell or marketing');
// Boundary sanity check: new nonzero LP fees prevent the original zero-remainder state on normal taxed sells.
// We do not assert that arbitrary dust-sized manual swapAndLiquifyNow calls can succeed.
const report={testedAt:new Date().toISOString(),forkBlock:Number(BigInt(block)),owner:OWNER,marketing,settings:{sellLiquidityBps:10,sellReceiverBps:390,receiverMarketingPercent:75,receiverBurnPercent:25},effectivePercent:{liquidity:0.1,marketing:2.925,buybackBurn:0.975},cycles:results,failedBurnStillPaidMarketingAndCompletedSell:true,originalTokenSwapThreshold:originalThreshold.toString(),testTokenSwapThreshold:testThreshold.toString(),testBurnThreshold:eth('.00001').toString(),scope:'Local Ethereum fork. Token fee balance/pending fees cleared before each test sell; token swap threshold lowered to exercise six successive payout cycles. Real ZYPTO, Uniswap router and LP pair used. No mainnet writes.'};
writeFileSync('artifacts/revised-fork-results.json',JSON.stringify(report,null,2));
}finally{await g.disconnect()}
