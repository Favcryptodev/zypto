import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletController} from '../dist/wallet.js';

const owner='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
class Host extends EventTarget { Event=Event; }
function wallet(options={}) {
  const listeners=new Map();
  const result={chain:options.chain||'0x1',accounts:[owner],calls:[],
    on(name,handler){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(handler)},
    removeListener(name,handler){listeners.get(name)?.delete(handler)},
    emit(name,value){for(const handler of [...(listeners.get(name)||[])])handler(value)},
    count(){return [...listeners.values()].reduce((sum,set)=>sum+set.size,0)},
    async request({method,params}){
      result.calls.push(method);
      if(options.request)return options.request({method,params},result);
      if(method==='eth_requestAccounts'&&options.reject)throw options.reject;
      if(method==='eth_accounts'||method==='eth_requestAccounts')return result.accounts;
      if(method==='eth_chainId')return result.chain;
      if(method==='wallet_switchEthereumChain'){
        if(options.rejectSwitch)throw options.rejectSwitch;
        result.chain=params[0].chainId;result.emit('chainChanged',result.chain);return null;
      }
      throw Error('Unexpected wallet request: '+method);
    },
  };
  return result;
}
function setup(provider,options={}) {
  const host=new Host();host.ethereum=provider;
  const states=[];
  const controller=createWalletController({window:host,onState:s=>states.push(s),...options});
  controller.start();
  return{host,controller,states};
}
function announce(host,provider,name='Test wallet') {
  const event=new Event('eip6963:announceProvider');
  Object.defineProperty(event,'detail',{value:{info:{uuid:'test',name,rdns:'test.wallet',icon:''},provider}});
  host.dispatchEvent(event);
}

test('discovery never prompts, signs, or sends; missing wallet gives recovery',async()=>{
  const{controller}=setup();await controller.connect();
  assert.match(controller.getState().error,/No Ethereum wallet/);controller.destroy();
});
test('legacy connection and account changes work without signatures',async()=>{
  const provider=wallet();const{controller}=setup(provider);
  assert.deepEqual(provider.calls,[]);
  await controller.connect();assert.equal(controller.getState().status,'connected');
  assert.equal(controller.getState().account,owner);
  provider.emit('accountsChanged',[other]);assert.equal(controller.getState().account,other);
  provider.emit('accountsChanged',[]);assert.equal(controller.getState().status,'idle');
  assert.equal(provider.count(),0);
  assert(provider.calls.every(method=>['eth_requestAccounts','eth_accounts','eth_chainId'].includes(method)));
  controller.destroy();
});
test('EIP-6963 discovers multiple wallets and uses the selected provider only',async()=>{
  const first=wallet(),second=wallet();const{host,controller}=setup();
  announce(host,first,'First');announce(host,second,'Second');announce(host,first,'First');
  const choices=controller.getProviders();assert.equal(choices.length,2);
  await controller.connect();assert.match(controller.getState().error,/Choose/);
  await controller.connect(choices[1].id);assert.equal(controller.getState().walletName,'Second');
  assert.deepEqual(first.calls,[]);assert(second.calls.length>0);controller.destroy();
});
test('late discovery upgrades a legacy wallet name and ignores malformed announcements',()=>{
  const provider=wallet();const{host,controller}=setup(provider);
  announce(host,provider,'Named wallet');announce(host,{},'Invalid');
  assert.deepEqual(controller.getProviders(),[{id:'wallet-0',name:'Named wallet'}]);controller.destroy();
});
test('switches to Ethereum chain 1 and verifies the result',async()=>{
  const provider=wallet({chain:'0x89'});const{controller}=setup(provider);
  await controller.connect();assert.equal(controller.getState().chainId,'0x1');
  assert(provider.calls.includes('wallet_switchEthereumChain'));
  provider.emit('chainChanged','0x89');assert.equal(controller.getState().status,'wrong-network');
  provider.emit('chainChanged','0x1');assert.equal(controller.getState().status,'connected');controller.destroy();
});
test('rejected account request and rejected network switch stay disconnected',async()=>{
  for(const options of [{reject:{code:4001}},{chain:'0xa',rejectSwitch:{code:4001}},{chain:'0xa',rejectSwitch:{code:4902}}]){
    const provider=wallet(options);const{controller}=setup(provider);await controller.connect();
    assert.equal(controller.getState().status,'error');assert.equal(controller.getState().account,null);
    assert.equal(provider.count(),0);assert.match(controller.getState().error,/cancelled|unavailable/);controller.destroy();
  }
});
test('pending/disconnected/unsupported errors have actionable text',async()=>{
  for(const [code,pattern]of[[-32002,/already open/],[4900,/disconnected/],[4100,/not authorized/],[4200,/does not support/]]){
    const{controller}=setup(wallet({reject:{code}}));await controller.connect();assert.match(controller.getState().error,pattern);controller.destroy();
  }
});
test('disconnect cleans up listeners and does not reconnect from stale events',async()=>{
  const provider=wallet();const{controller}=setup(provider);await controller.connect();
  assert.equal(provider.count(),3);controller.disconnect();assert.equal(provider.count(),0);
  provider.emit('accountsChanged',[other]);assert.equal(controller.getState().account,null);
  await controller.connect();assert.equal(provider.count(),3);
  provider.emit('disconnect',{});assert.equal(controller.getState().status,'idle');assert.equal(provider.count(),0);controller.destroy();
});
test('late approval after local disconnect cannot restore a session',async()=>{
  let approve;
  const provider=wallet({request:({method})=>method==='eth_requestAccounts'?new Promise(resolve=>{approve=resolve}):Promise.resolve('0x1')});
  const{controller}=setup(provider);const pending=controller.connect();await new Promise(resolve=>setImmediate(resolve));
  controller.disconnect();approve([owner]);await pending;
  assert.equal(controller.getState().status,'idle');assert.equal(controller.getState().account,null);controller.destroy();
});
test('duplicate connect clicks open only one account request',async()=>{
  let approve;const provider=wallet({request:({method})=>method==='eth_requestAccounts'?new Promise(resolve=>{approve=resolve}):Promise.resolve(method==='eth_chainId'?'0x1':[owner])});
  const{controller}=setup(provider);const first=controller.connect();await controller.connect();
  await new Promise(resolve=>setImmediate(resolve));approve([owner]);await first;
  assert.equal(provider.calls.filter(method=>method==='eth_requestAccounts').length,1);controller.destroy();
});
test('timeouts and invalid/empty accounts recover without enabling controls',async()=>{
  const{controller}=setup(wallet({request:()=>new Promise(()=>{})}),{timeoutMs:15});await controller.connect();
  assert.match(controller.getState().error,/timed out/);assert.equal(controller.getState().provider,null);controller.destroy();
  const empty=wallet();empty.accounts=[];const second=setup(empty);await second.controller.connect();
  assert.match(second.controller.getState().error,/No wallet account/);second.controller.destroy();
});
