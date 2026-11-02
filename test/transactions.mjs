import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {Interface,getAddress,ZeroAddress} from '../dist/ethers.js';
const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const owner='0x1111111111111111111111111111111111111111',newReceiver='0x2222222222222222222222222222222222222222';let liq=100n,mkt=300n,receiver='0x3333333333333333333333333333333333333333',account=owner,exempt=false,code='0x1234',sends=[];
const els=new Map();const el=id=>els.get(id)||els.set(id,{value:'',textContent:'',disabled:false,classList:{toggle(){}},addEventListener(){},replaceChildren(){},append(){}}).get(id);
const wallet={request:async({method})=>method==='eth_chainId'?'0x1':[account],on(){}};
class Provider{async getNetwork(){return{chainId:1n}}async getBlockNumber(){return 123}async getSigner(){return{}}async getCode(){return code}destroy(){}}
class C{constructor(){for(const [n,f]of Object.entries({owner:()=>owner,_marketingWallet:()=>receiver,_sellFeeLiquidity:()=>liq,_sellFeeMarketing:()=>mkt,_sellFeeTotal:()=>liq+mkt,_buyFeeLiquidity:()=>0n,_buyFeeMarketing:()=>0n,_isExcludedFromFees:()=>exempt}))this[n]=async()=>f();for(const n of ['setSellFee','setMarketingWallet']){this[n]=async(...args)=>{sends.push([n,args]);if(n==='setSellFee')[liq,mkt]=args;else receiver=args[0];return{hash:'0x'+'a'.repeat(64),wait:async()=>({status:1})}};this[n].staticCall=async()=>{}}}}
const ctx=vm.createContext({document:{getElementById:el,createElement:()=>({})},window:{ethereum:wallet},BrowserProvider:Provider,JsonRpcProvider:Provider,FetchRequest:class{},Contract:C,getAddress,ZeroAddress});vm.runInContext(source.replace(/^import .*?;\n/,'').replaceAll('export ',''),ctx);await new Promise(r=>setTimeout(r,10));await vm.runInContext('connect()',ctx);
assert.equal(el('setFee').disabled,false);assert.equal(el('setReceiver').disabled,true);
await vm.runInContext("execute('fee')",ctx);assert.equal(sends[0][0],'setSellFee');assert.equal(sends[0][1][0],10n);assert.equal(sends[0][1][1],390n);assert.equal(el('setFee').disabled,true);
el('newReceiver').value=newReceiver;vm.runInContext('render()',ctx);await vm.runInContext("execute('receiver')",ctx);assert.equal(sends.length,1,'unexempt receiver blocked');
exempt=true;code='0x';await vm.runInContext("execute('receiver')",ctx);assert.equal(sends.length,1,'undeployed receiver blocked');
code='0x1234';await vm.runInContext("execute('receiver')",ctx);assert.equal(sends.length,2);assert.equal(receiver,newReceiver);
account=newReceiver;await vm.runInContext('connect()',ctx);await vm.runInContext("execute('fee')",ctx);assert.equal(sends.length,2,'nonowner blocked');
const iface=new Interface(vm.runInContext('ABI',ctx));assert.deepEqual([...iface.decodeFunctionData('setSellFee',iface.encodeFunctionData('setSellFee',[10,390]))],[10n,390n]);
console.log('PASS: 10/390 calldata; setup ordering; undeployed/unexempt receiver blocks; owner enforcement; confirmed state refresh. No real transactions.');
