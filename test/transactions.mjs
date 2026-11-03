import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interface} from '../dist/ethers.js';
import {DEPLOYMENT as D} from '../dist/deployment.js';
import {TOKEN_ABI,stepsFor,actionFor,createSetupFlow,createEthereumAdapter,readSetup} from '../dist/setup.js';
const OWNER='0x1111111111111111111111111111111111111111',OTHER='0x2222222222222222222222222222222222222222';
const iface=new Interface(TOKEN_ABI),hash='0x'+'a'.repeat(64);
const initial=()=>({verified:true,block:1,owner:OWNER,receiver:D.payout,liq:100n,mkt:300n,total:400n,buyLiq:0n,buyMkt:0n,buyTotal:0n,exempt:false});
function fixture(overrides={}){
 let snapshot={...initial(),...overrides},revision=0,account=OWNER,chain=1n,now=0;
 const sent=[],calls=[];let reviewQuote=1200n,quoteGas=120n,balance=100000n,requestError=null,receiptError=null,receiptStatus=1,receiptAvailable=true,afterQuote=null,afterSend=null;
 const wallet={};
 const adapter={
  session:()=>({revision,account,wallet}),
  async read(){calls.push('read');if(!snapshot.verified)throw Error('Contract code mismatch');return Object.freeze({...snapshot})},
  async identity(snap,state){if(chain!==1n)throw Error('Wrong chain');if(snap.revision!==revision||snap.account!==account)throw Error('Wallet changed');if(account!==state.owner)throw Error('Wrong owner')},
  async quote(step,session){calls.push('quote');if(afterQuote){const f=afterQuote;afterQuote=null;await f()};if(balance<reviewQuote)throw Error('Insufficient ETH for gas');return{tx:Object.freeze({from:session.account,to:D.token,data:iface.encodeFunctionData(step.fn,step.args),value:0n,chainId:1n,gasLimit:quoteGas,maxFeePerGas:10n,maxPriorityFeePerGas:1n}),maxGasCost:reviewQuote,balance}},
  async send(review){if(requestError)throw requestError;sent.push(review);if(afterSend)afterSend();return{hash}},
  async receipt(){if(receiptError)throw receiptError;return applyReceipt()},
  async checkReceipt(){return receiptAvailable?applyReceipt():null},
  async transaction(){return sent.at(-1)?.quote.tx},
 };
 function applyReceipt(){if(receiptStatus===1){const key=sent.at(-1)?.step.key;if(key==='exempt')snapshot.exempt=true;if(key==='fees'){snapshot.liq=10n;snapshot.mkt=390n;snapshot.total=400n}if(key==='receiver')snapshot.receiver=D.receiver}return{status:receiptStatus,blockNumber:2}}
 const flow=createSetupFlow(adapter,{now:()=>now});
 return{flow,adapter,sent,calls,get snapshot(){return snapshot},set snapshot(v){snapshot=v},setAccount(v){account=v;revision++},setChain(v){chain=v},expire(){now=120001},setQuote(v){reviewQuote=v},setGas(v){quoteGas=v},setBalance(v){balance=v},reject(e){requestError=e},receiptError(e){receiptError=e},receiptStatus(v){receiptStatus=v},receiptAvailable(v){receiptAvailable=v},afterQuote(f){afterQuote=f},afterSend(f){afterSend=f}};
}
test('fixed three-call order, exact addresses/values, no automatic next transaction, unchanged buy fees',async()=>{
 const f=fixture();await f.flow.refresh();
 for(const key of ['exempt','fees','receiver']){
  assert.equal(await f.flow.prepare(key),true);assert.equal(f.sent.length,['exempt','fees','receiver'].indexOf(key));
  const review=f.flow.getState().review;assert.equal(review.quote.tx.to,D.token);assert.equal(review.quote.tx.value,0n);assert.equal(review.quote.tx.chainId,1n);
  assert.equal(await f.flow.confirm(),true);assert.equal(f.flow.getState().phase,'success');
 }
 assert.deepEqual(f.sent.map(r=>r.step.fn),['excludeFromFees','setSellFee','setMarketingWallet']);
 assert.deepEqual([...iface.decodeFunctionData('setSellFee',f.sent[1].quote.tx.data)],[10n,390n]);
 assert.equal(iface.decodeFunctionData('excludeFromFees',f.sent[0].quote.tx.data)[0],D.receiver);
 assert.equal(iface.decodeFunctionData('excludeFromFees',f.sent[0].quote.tx.data)[1],true);
 assert.equal(iface.decodeFunctionData('setMarketingWallet',f.sent[2].quote.tx.data)[0],D.receiver);
 assert.deepEqual([f.snapshot.buyLiq,f.snapshot.buyMkt,f.snapshot.buyTotal],[0n,0n,0n]);
 assert(stepsFor(f.snapshot).every(s=>s.done));
});
test('future nonzero buy fees are preserved as well',async()=>{
 const f=fixture({buyLiq:3n,buyMkt:7n,buyTotal:10n});await f.flow.prepare('exempt');await f.flow.confirm();
 assert.deepEqual([f.snapshot.buyLiq,f.snapshot.buyMkt],[3n,7n]);
});
test('receiver cannot be switched before exemption and fee steps',async()=>{
 const f=fixture();assert.equal(await f.flow.prepare('receiver'),false);assert.equal(await f.flow.prepare('fees'),false);assert.equal(f.sent.length,0);
});
test('already-configured steps are skipped, including all-complete state',async()=>{
 const f=fixture({exempt:true,liq:10n,mkt:390n,total:400n});
 assert.equal(await f.flow.prepare('exempt'),false);assert.equal(await f.flow.prepare('fees'),false);
 assert(await f.flow.prepare('receiver'));assert(await f.flow.confirm());
 assert.equal(await f.flow.prepare('receiver'),false);assert.equal(f.sent.length,1);
});
test('a step completed elsewhere between review and confirm is not sent again',async()=>{
 const f=fixture();await f.flow.prepare('exempt');f.snapshot.exempt=true;assert.equal(await f.flow.confirm(),false);assert.equal(f.sent.length,0);
});
test('wrong chain, wrong owner and unverified contracts fail closed',async()=>{
 for(const kind of ['chain','owner','code']){
  const f=fixture();if(kind==='chain')f.setChain(137n);if(kind==='owner')f.setAccount(OTHER);if(kind==='code')f.snapshot.verified=false;
  assert.equal(await f.flow.prepare('exempt'),false);assert.equal(f.sent.length,0);
 }
});
test('direct confirmation without review and unsupported processing/signature actions cannot send',async()=>{
 const f=fixture();assert.equal(await f.flow.confirm(),false);
 for(const action of ['process','approve','sign','unknown'])assert.equal(await f.flow.prepare(action),false);
 assert.equal(f.sent.length,0);
});
test('rejected wallet confirmation stops the flow and never advances',async()=>{
 const f=fixture();await f.flow.prepare('exempt');f.reject(Object.assign(Error('Rejected'),{code:4001}));
 assert.equal(await f.flow.confirm(),false);assert.equal(f.flow.getState().phase,'error');assert.equal(f.snapshot.exempt,false);assert.equal(f.sent.length,0);
 assert.equal(await f.flow.prepare('fees'),false);
});
test('reverted receipt stops and does not mark a setting complete',async()=>{
 const f=fixture();await f.flow.prepare('exempt');f.receiptStatus(0);
 assert.equal(await f.flow.confirm(),false);assert.equal(f.flow.getState().phase,'error');assert.equal(f.snapshot.exempt,false);assert.equal(f.sent.length,1);
});
test('timeout after broadcast locks further writes until a receipt is checked',async()=>{
 const f=fixture();await f.flow.prepare('exempt');f.receiptError(Error('Timed out'));
 assert.equal(await f.flow.confirm(),false);assert.equal(f.flow.getState().phase,'uncertain');
 assert.equal(await f.flow.prepare('fees'),false);assert.equal(await f.flow.confirm(),false);
 f.receiptAvailable(false);assert.equal(await f.flow.recheck(),false);assert.equal(f.sent.length,1);
 f.receiptAvailable(true);assert.equal(await f.flow.recheck(),true);assert.equal(f.snapshot.exempt,true);
});
test('unknown wallet response without a hash stays locked, including refresh',async()=>{
 const f=fixture();await f.flow.prepare('exempt');f.adapter.send=async()=>({});
 assert.equal(await f.flow.confirm(),false);await f.flow.refresh();assert.equal(f.flow.getState().phase,'uncertain');assert.equal(await f.flow.prepare('fees'),false);
});
test('gas increase, insufficient ETH, balance drop and expired reviews require another review',async()=>{
 for(const kind of ['fees','limit','balance','expired']){
  const f=fixture();await f.flow.prepare('exempt');if(kind==='fees')f.setQuote(1300n);if(kind==='limit')f.setGas(121n);if(kind==='balance')f.setBalance(100n);if(kind==='expired')f.expire();
  assert.equal(await f.flow.confirm(),false,kind);assert.equal(f.sent.length,0);
 }
});
test('account/network changes before confirmation or during preparation never send',async()=>{
 const f=fixture();await f.flow.prepare('exempt');f.setAccount(OTHER);assert.equal(await f.flow.confirm(),false);assert.equal(f.sent.length,0);
 const second=fixture();await second.flow.prepare('exempt');second.setChain(10n);assert.equal(await second.flow.confirm(),false);
 const third=fixture();third.afterQuote(()=>{third.setAccount(OTHER);third.flow.invalidate()});assert.equal(await third.flow.prepare('exempt'),false);assert.equal(third.sent.length,0);
});
test('buy fee change after review blocks, and change after receipt stops further setup',async()=>{
 const f=fixture();await f.flow.prepare('exempt');f.snapshot.buyMkt=1n;f.snapshot.buyTotal=1n;assert.equal(await f.flow.confirm(),false);assert.equal(f.sent.length,0);
 const second=fixture();await second.flow.prepare('exempt');second.afterSend(()=>{second.snapshot.buyMkt=1n;second.snapshot.buyTotal=1n});assert.equal(await second.flow.confirm(),false);assert.equal(second.flow.getState().phase,'uncertain');
});
test('duplicate clicks do not request duplicate transactions',async()=>{
 const f=fixture();await f.flow.prepare('exempt');const first=f.flow.confirm();assert.equal(await f.flow.confirm(),false);await first;assert.equal(f.sent.length,1);
});
test('review can be cancelled with no wallet request',async()=>{
 const f=fixture();await f.flow.prepare('exempt');f.flow.cancel();assert.equal(await f.flow.confirm(),false);assert.equal(f.sent.length,0);
});
test('simulation failure and changed confirmed transaction both stop setup',async()=>{
 const f=fixture();f.adapter.quote=async()=>{throw Error('Simulation reverted')};assert.equal(await f.flow.prepare('exempt'),false);assert.equal(f.sent.length,0);
 const second=fixture();await second.flow.prepare('exempt');second.adapter.transaction=async()=>({...second.sent.at(-1).quote.tx,to:OTHER});assert.equal(await second.flow.confirm(),false);assert.equal(second.flow.getState().phase,'uncertain');assert.equal(await second.flow.prepare('fees'),false);
});
test('balance must still cover the displayed cap even if the fresh estimate is lower',async()=>{
 const f=fixture();await f.flow.prepare('exempt');f.setQuote(1000n);f.setBalance(1100n);assert.equal(await f.flow.confirm(),false);assert.equal(f.sent.length,0);
});
test('real Ethereum adapter simulates, uses gas buffer, zero value and EIP-1559 caps',async()=>{
 const calls=[];const p={async call(tx){calls.push(['call',tx])},async estimateGas(){return 100n},async getFeeData(){return{maxFeePerGas:10n,maxPriorityFeePerGas:2n}},async getBalance(){return 10000n}};
 const a=createEthereumAdapter({getSession:()=>({}),getProvider:()=>p});
 const q=await a.quote(actionFor(initial(),'exempt'),{account:OWNER});assert.equal(q.tx.gasLimit,120n);assert.equal(q.tx.value,0n);assert.equal(q.maxGasCost,1200n);assert.equal(q.tx.maxFeePerGas,10n);assert.equal(calls[0][0],'call');
 p.getBalance=async()=>1199n;await assert.rejects(a.quote(actionFor(initial(),'exempt'),{account:OWNER}),/more ETH/);
});
test('legacy gas prices and invalid/missing fee data are handled explicitly',async()=>{
 const p={async call(){},async estimateGas(){return 100n},async getFeeData(){return{gasPrice:8n}},async getBalance(){return 10000n}};
 const a=createEthereumAdapter({getSession:()=>({}),getProvider:()=>p});assert.equal((await a.quote(actionFor(initial(),'exempt'),{account:OWNER})).tx.gasPrice,8n);
 p.getFeeData=async()=>({});await assert.rejects(a.quote(actionFor(initial(),'exempt'),{account:OWNER}),/unavailable/);
 p.getFeeData=async()=>({maxFeePerGas:1n,maxPriorityFeePerGas:2n});await assert.rejects(a.quote(actionFor(initial(),'exempt'),{account:OWNER}),/Invalid/);
});
test('readSetup rejects wrong chain and wrong deployed code before enabling setup',async()=>{
 await assert.rejects(readSetup({send:async()=> '0x89'}),/mainnet/);
 await assert.rejects(readSetup({send:async m=>m==='eth_chainId'?'0x1':'0x10',getCode:async()=> '0x'}),/code does not match/);
});
test('no editable receiver, no URL/storage configuration and no buy-fee write ABI',()=>{
 const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 const config=readFileSync(new URL('../dist/deployment.js',import.meta.url),'utf8');
 assert(!/<input\b/i.test(html));assert(Object.isFrozen(D));assert.equal(D.receiver,'0xC4C6B2320Fc2E77d55007dd22daE1f2D70826CE3');
 assert(!/localStorage\.|sessionStorage\.|URLSearchParams\(/.test(config));
 assert.equal(iface.getFunction('setBuyFee'),null);assert.equal(iface.getFunction('approve'),null);
 assert(html.includes('id="confirm"'));assert(html.includes('0 ETH'));
});
