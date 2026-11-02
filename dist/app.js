import {BrowserProvider, JsonRpcProvider, FetchRequest, Contract, ZeroAddress} from './ethers.js';
import {createWalletController} from './wallet.js';
import {getReceiverDeployment, denyTransactionAction, TRANSACTION_LOCK_MESSAGE} from './deployment.js';
export const ADDRESS='0x7a65cb87f596caf31a4932f074c59c0592be77d7';
export const ABI=['function owner() view returns(address)','function _marketingWallet() view returns(address)','function _sellFeeLiquidity() view returns(uint256)','function _sellFeeMarketing() view returns(uint256)','function _sellFeeTotal() view returns(uint256)','function _buyFeeLiquidity() view returns(uint256)','function _buyFeeMarketing() view returns(uint256)'];
const $=id=>document.getElementById(id);
let wallet=null,provider=null,account=null,snapshot=null,refreshId=0;
let connection={status:'idle',error:''};
const rpcUrls=['https://ethereum-rpc.publicnode.com','https://eth.drpc.org'];
const short=a=>a.slice(0,6)+'…'+a.slice(-4);
const pct=n=>Number(n)/100+'%';
function say(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error)}
function render(){
  const owner=!!(connection.status==='connected'&&snapshot&&account&&snapshot.owner.toLowerCase()===account.toLowerCase());
  const deployment=getReceiverDeployment();
  const connecting=connection.status==='connecting';
  $('configuredReceiver').textContent=deployment.label;
  $('deploymentState').textContent='Awaiting verified deployment';
  $('actionLock').textContent=TRANSACTION_LOCK_MESSAGE;
  $('update').disabled=true;
  $('update').setAttribute('aria-disabled','true');
  $('connect').disabled=connecting;
  $('connect').textContent=connecting?'Connecting…':connection.status==='wrong-network'?'Switch to Ethereum':account?'Reconnect wallet':'Connect wallet';
  $('connect').setAttribute('aria-busy',String(connecting));
  $('disconnect').hidden=!account&&!connecting&&connection.status!=='wrong-network';
  $('disconnect').disabled=false;
  $('walletSelect').disabled=connecting||!!account||connection.status==='wrong-network';
  $('findWallets').disabled=connecting;
  $('refresh').disabled=false;
  let text;
  if(connection.error)text=connection.error;
  else if(connecting)text='Open '+connection.walletName+' and approve account access. Connecting does not sign or send a transaction.';
  else if(account)text=connection.walletName+' · '+short(account)+' · Ethereum mainnet. '+(snapshot?(owner?'Token owner verified. Transaction actions remain locked until receiver deployment is verified.':'Read-only: this account is not the token owner.'):'Reading token data. Transaction actions remain locked.');
  else text='Choose an Ethereum wallet and connect for read-only access. Use a browser extension or your wallet’s in-app browser. QR pairing is not enabled.';
  $('walletState').textContent=text;
  $('walletState').classList.toggle('error',connection.status==='error'||connection.status==='wrong-network');
}
async function read(p){
  const network=await p.getNetwork();if(network.chainId!==1n)throw Error('Switch your wallet to Ethereum mainnet.');
  const block=await p.getBlockNumber();const c=new Contract(ADDRESS,ABI,p);
  const names=['owner','_marketingWallet','_sellFeeLiquidity','_sellFeeMarketing','_sellFeeTotal','_buyFeeLiquidity','_buyFeeMarketing'];
  const v=await Promise.all(names.map(n=>c[n]({blockTag:block})));
  return{owner:v[0],receiver:v[1],liq:v[2],mkt:v[3],total:v[4],buyLiq:v[5],buyMkt:v[6],block};
}
function readWithDeadline(p){
  let timer;
  return Promise.race([read(p),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Ethereum read timed out. Check your connection and choose Refresh.')),15000)})]).finally(()=>clearTimeout(timer));
}
async function refresh(){
  const id=++refreshId;snapshot=null;render();
  $('readState').textContent='Reading Ethereum. Previous values, if displayed, may be stale.';
  try{
    let s;
    if(provider)s=await readWithDeadline(provider);
    else{
      for(const url of rpcUrls){
        const req=new FetchRequest(url);req.timeout=10000;
        const p=new JsonRpcProvider(req,1,{staticNetwork:true,batchMaxCount:1});
        try{s=await readWithDeadline(p);break}catch{}finally{p.destroy()}
      }
      if(!s)throw Error('Public Ethereum reads are unavailable. Connect an Ethereum wallet or choose Refresh to retry.');
    }
    if(id!==refreshId)return;
    snapshot=s;$('owner').textContent=s.owner;$('receiver').textContent=s.receiver;
    $('liq').textContent=pct(s.liq);$('mkt').textContent=pct(s.mkt);$('total').textContent=pct(s.total);
    $('buy').textContent=pct(s.buyLiq)+' liquidity / '+pct(s.buyMkt)+' marketing';
    $('readState').textContent='Verified at Ethereum block '+s.block.toLocaleString();
    if(s.owner===ZeroAddress)say('Ownership is renounced. This console remains read-only.',true);
  }catch(e){
    if(id!==refreshId)return;snapshot=null;
    for(const name of ['owner','receiver','liq','mkt','total','buy'])$(name).textContent='Unavailable';
    $('readState').textContent=e.shortMessage||e.message;
  }finally{if(id===refreshId)render()}
}
const controller=createWalletController({
  window,
  onProviders(choices){
    const select=$('walletSelect'),selected=select.value;select.replaceChildren();
    if(!choices.length){const option=document.createElement('option');option.value='';option.textContent='No wallet detected';select.append(option)}
    for(const choice of choices){const option=document.createElement('option');option.value=choice.id;option.textContent=choice.name;select.append(option)}
    if(choices.some(choice=>choice.id===selected))select.value=selected;
    render();
  },
  onState(next){
    connection=next;refreshId++;
    const previous=provider;wallet=next.provider;account=next.status==='connected'?next.account:null;
    provider=account?new BrowserProvider(wallet):null;previous?.destroy();snapshot=null;render();
    if(account){say('Wallet connected to Ethereum. Connecting did not sign or send a transaction.');refresh()}
    else if(next.status==='error')say(next.error,true);
  },
});
async function connect(){await controller.connect($('walletSelect').value)}
export function execute(action='update'){
  // Enforced even when invoked directly or when DOM disabled state is changed.
  // No signer, write contract, signature, approval or process call is created.
  const result=denyTransactionAction(action);
  say(result.reason,true);
  return result.allowed;
}

$('connect').addEventListener('click',connect);
$('disconnect').addEventListener('click',()=>{
  controller.disconnect('Disconnected from this page. You can also remove site permissions in your wallet.');
  say('Wallet disconnected from this page.');refresh();
});
$('findWallets').addEventListener('click',()=>{
  controller.discover();
  say(controller.getProviders().length?'Choose your wallet, then connect.':'No Ethereum wallet detected. Open this page in your wallet’s in-app browser, or install a browser wallet extension.');
});
$('refresh').addEventListener('click',refresh);
$('update').addEventListener('click',()=>execute('update'));
controller.start();render();refresh();
