import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {Interface,ZeroAddress} from '../dist/ethers.js';
import {createWalletController} from '../dist/wallet.js';
import {getReceiverDeployment,denyTransactionAction,TRANSACTION_LOCK_MESSAGE} from '../dist/deployment.js';

const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const owner='0x1111111111111111111111111111111111111111';
const staleReceiver='0x2222222222222222222222222222222222222222';
const methods=[],financial=[];
let account=owner,signerRequests=0,reads=0;
const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,{
  value:'',textContent:'',disabled:false,attributes:{},listeners:new Map(),
  classList:{toggle(){}},replaceChildren(){},append(){},
  setAttribute(name,value){this.attributes[name]=value},
  addEventListener(name,handler){this.listeners.set(name,handler)},
}]));
const element=id=>{const result=elements.get(id);assert(result,'Unknown/removed element requested: '+id);return result};
const wallet={
  async request({method}){
    methods.push(method);
    if(method==='eth_chainId')return '0x1';
    if(method==='eth_accounts'||method==='eth_requestAccounts')return [account];
    financial.push(method);throw Error('Forbidden wallet method: '+method);
  },on(){},removeListener(){},
};
class Provider{
  async getNetwork(){return{chainId:1n}}
  async getBlockNumber(){reads++;return 123}
  async getSigner(){signerRequests++;throw Error('Signer must never be created while locked')}
  destroy(){}
}
class ReadOnlyContract{
  constructor(){
    const values={owner:()=>owner,_marketingWallet:()=>staleReceiver,_sellFeeLiquidity:()=>100n,_sellFeeMarketing:()=>300n,_sellFeeTotal:()=>400n,_buyFeeLiquidity:()=>0n,_buyFeeMarketing:()=>0n};
    for(const[name,read]of Object.entries(values))this[name]=async()=>read();
    for(const name of ['setSellFee','setMarketingWallet','approve','process','processWETH','depositWETH']){
      this[name]=async()=>{financial.push(name);throw Error('Forbidden write contract call: '+name)};
      this[name].staticCall=async()=>{financial.push('simulate:'+name);throw Error('No financial preflight while locked')};
    }
  }
}
const host=new EventTarget();host.Event=Event;host.ethereum=wallet;
host.location={href:'https://terranlabs.xyz/?receiver='+staleReceiver+'&action=update&deployed=true#process',search:'?receiver='+staleReceiver+'&action=update&deployed=true',hash:'#process'};
host.RECEIVER_DEPLOYMENT={receiver:staleReceiver,verified:true,transactionsEnabled:true};
host.localStorage={getItem(){assert.fail('Saved browser settings must not configure the receiver')}};
const ctx=vm.createContext({
  setTimeout,clearTimeout,createWalletController,getReceiverDeployment,denyTransactionAction,TRANSACTION_LOCK_MESSAGE,
  document:{getElementById:element,createElement:()=>({})},window:host,localStorage:host.localStorage,location:host.location,
  BrowserProvider:Provider,JsonRpcProvider:Provider,FetchRequest:class{},Contract:ReadOnlyContract,ZeroAddress,
});
vm.runInContext(source.replace(/^import .*?;\r?\n/gm,'').replaceAll('export ',''),ctx);
await vm.runInContext('refresh()',ctx);
assert.equal(element('configuredReceiver').textContent,'To be deployed');
assert.equal(element('update').disabled,true);
assert.equal(element('refresh').disabled,false);
assert.equal(element('connect').disabled,false);
assert.equal(vm.runInContext("execute('update')",ctx),false,'disconnected direct call denied');

await vm.runInContext('connect()',ctx);
await vm.runInContext('refresh()',ctx);
assert.equal(vm.runInContext('account',ctx),owner,'owner wallet connection still works');
assert.equal(vm.runInContext('snapshot.owner',ctx),owner,'owner is actually verified for this test');
assert.match(element('walletState').textContent,/Transaction actions remain locked/);
assert.equal(element('update').disabled,true,'even verified owner cannot update');
assert.equal(element('disconnect').hidden,false);
assert.equal(element('refresh').disabled,false);

for(const action of ['update','fee','receiver','process','approve','sign','eth_sendTransaction','wallet_sendCalls']){
  assert.equal(vm.runInContext('execute('+JSON.stringify(action)+')',ctx),false,'direct invocation denied: '+action);
}
// Simulate an old page or user-injected address field and overridden disabled UI.
elements.set('newReceiver',{value:staleReceiver});
element('update').disabled=false;
assert.equal(element('update').listeners.get('click')(),false,'tampered button handler stays locked');
vm.runInContext('render()',ctx);
assert.equal(element('update').disabled,true);
assert.equal(element('configuredReceiver').textContent,'To be deployed');
assert.match(element('status').textContent,/Receiver deployment is not verified/);

const beforeReads=reads;await element('refresh').listeners.get('click')();
assert(reads>beforeReads,'read-only refresh remains available');
element('disconnect').listeners.get('click')();
assert.equal(vm.runInContext('account',ctx),null);
assert.equal(element('connect').disabled,false);
assert.equal(element('update').disabled,true);

assert.equal(signerRequests,0);
assert.deepEqual(financial,[],'no transaction, approval, signature, process or financial simulation');
assert(methods.every(method=>['eth_chainId','eth_accounts','eth_requestAccounts','wallet_switchEthereumChain'].includes(method)));
assert(Object.isFrozen(getReceiverDeployment()));
assert.equal(getReceiverDeployment().receiver,null);
assert.equal(getReceiverDeployment().transactionsEnabled,false);
assert.throws(()=>{getReceiverDeployment().receiver=staleReceiver},TypeError);
assert(!/<input\b/i.test(html),'receiver address entry removed entirely');
assert(!html.includes('id="newReceiver"'));
const iface=new Interface(vm.runInContext('ABI',ctx));
assert(iface.fragments.every(fragment=>fragment.type==='function'&&fragment.stateMutability==='view'),'ABI exposes reads only');
assert(!/getSigner\s*\(|\.sendTransaction\s*\(|\.sign(?:Message|TypedData)\s*\(/.test(source),'no financial execution path in app');
console.log('PASS: undeployed lock survives owner connection, direct handlers, altered disabled UI, stale receiver field, saved settings and deep links; read-only refresh/connect/disconnect work; zero financial calls.');
