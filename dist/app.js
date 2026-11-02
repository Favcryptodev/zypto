import {BrowserProvider, JsonRpcProvider, FetchRequest, Contract, getAddress, ZeroAddress} from './ethers.js';
import {createWalletController} from './wallet.js';
export const ADDRESS='0x7a65cb87f596caf31a4932f074c59c0592be77d7';
export const ABI=['function owner() view returns(address)','function _marketingWallet() view returns(address)','function _sellFeeLiquidity() view returns(uint256)','function _sellFeeMarketing() view returns(uint256)','function _sellFeeTotal() view returns(uint256)','function _buyFeeLiquidity() view returns(uint256)','function _buyFeeMarketing() view returns(uint256)','function setSellFee(uint256 liquidityFee,uint256 marketingFee)','function setMarketingWallet(address account)','function _isExcludedFromFees(address) view returns(bool)'];
const $=id=>document.getElementById(id);
let wallet=null,provider=null,account=null,snapshot=null,busy=false,epoch=0,refreshId=0;
let connection={status:'idle',error:''};
const rpcUrls=['https://ethereum-rpc.publicnode.com','https://eth.drpc.org'];
const short=a=>a.slice(0,6)+'…'+a.slice(-4);
const pct=n=>Number(n)/100+'%';
function say(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error)}
export function validReceiver(value,current){try{const a=getAddress(value.trim());return a!==ZeroAddress&&a.toLowerCase()!==ADDRESS&&a.toLowerCase()!==current?.toLowerCase()?a:null}catch{return null}}
function render(){
  const owner=!!(connection.status==='connected'&&snapshot&&account&&snapshot.owner.toLowerCase()===account.toLowerCase());
  const ready=!!(snapshot&&snapshot.liq===10n&&snapshot.mkt===390n);
  const receiver=validReceiver($('newReceiver').value,snapshot?.receiver);
  const connecting=connection.status==='connecting';
  $('setFee').disabled=busy||!owner||ready;
  $('setReceiver').disabled=busy||!owner||!ready||!receiver;
  $('connect').disabled=busy||connecting;
  $('connect').textContent=connecting?'Connecting…':connection.status==='wrong-network'?'Switch to Ethereum':account?'Reconnect wallet':'Connect wallet';
  $('connect').setAttribute('aria-busy',String(connecting));
  $('disconnect').hidden=!account&&!connecting&&connection.status!=='wrong-network';
  $('disconnect').disabled=busy;
  $('walletSelect').disabled=busy||connecting||!!account||connection.status==='wrong-network';
  $('findWallets').disabled=busy||connecting;
  $('refresh').disabled=busy;
  $('newReceiver').disabled=busy;
  $('feeBadge').textContent=ready?'Already set':'First step';
  $('receiverBadge').textContent=ready?'Ready':'After step 1';
  const typed=$('newReceiver').value.trim();
  $('newReceiver').setAttribute('aria-invalid',String(!!typed&&!receiver));
  $('addressHint').textContent=typed?(receiver?'Valid address. Verify the deployed contract and every character before confirming.':'Enter a valid, different receiver address. Zero and token-contract addresses are blocked.'):'Enter a full 42-character Ethereum address.';
  let text;
  if(connection.error)text=connection.error;
  else if(connecting)text='Open '+connection.walletName+' and approve account access. Connecting does not sign or send a transaction.';
  else if(account)text=connection.walletName+' · '+short(account)+' · Ethereum mainnet. '+(snapshot?(owner?'Owner verified. Review each change before confirming in your wallet.':'Read-only: this account is not the token owner.'):'Reading token data before enabling controls.');
  else text='Choose an Ethereum wallet and connect. Use a browser extension or your wallet’s in-app browser. QR pairing is not enabled.';
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
    if(s.owner===ZeroAddress)say('Ownership is renounced. Owner-only changes cannot be made.',true);
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
    connection=next;epoch++;refreshId++;
    const previous=provider;wallet=next.provider;account=next.status==='connected'?next.account:null;
    provider=account?new BrowserProvider(wallet):null;previous?.destroy();snapshot=null;render();
    if(account){say('Wallet connected to Ethereum. Connecting did not sign or send a transaction.');refresh()}
    else if(next.status==='error')say(next.error,true);
  },
});
async function connect(){if(!busy)await controller.connect($('walletSelect').value)}
async function execute(kind){if(busy||connection.status!=='connected')return;const newAddress=validReceiver($('newReceiver').value,snapshot?.receiver);const runEpoch=epoch;const selectedAccount=account;busy=true;render();const output=$(kind==='fee'?'feeTx':'receiverTx');let submitted=false;try{if(!provider||!selectedAccount)throw Error('Connect the owner wallet first.');say('Checking owner, network and current settings…');const active=await wallet.request({method:'eth_accounts'});if(active[0]?.toLowerCase()!==selectedAccount.toLowerCase()||await wallet.request({method:'eth_chainId'})!=='0x1')throw Error('Wallet changed. Reconnect before continuing.');const selectedWallet=wallet;const p=provider;const s=await read(p);if(s.owner.toLowerCase()!==selectedAccount.toLowerCase())throw Error('Only the current contract owner can make this change.');if(kind==='receiver'&&(s.liq!==10n||s.mkt!==390n))throw Error('Complete step 1 before updating the receiver.');if(kind==='receiver'&&!validReceiver(newAddress||'',s.receiver))throw Error('Enter a valid, different receiver address.');if(kind==='fee'&&s.liq===10n&&s.mkt===390n)throw Error('Sell fees already match the requested values.');const signer=await p.getSigner(selectedAccount);const c=new Contract(ADDRESS,ABI,signer);if(kind==='receiver'){if(await p.getCode(newAddress)==='0x')throw Error('Deploy the fee receiver contract before activating it.');if(!await c._isExcludedFromFees(newAddress))throw Error('The token owner must first call excludeFromFees(receiverAddress, true) on ZYPTO to enable receiver buybacks.');}const fn=kind==='fee'?c.setSellFee:c.setMarketingWallet;const args=kind==='fee'?[10n,390n]:[newAddress];await fn.staticCall(...args);const finalAccounts=await selectedWallet.request({method:'eth_accounts'});const finalChain=await selectedWallet.request({method:'eth_chainId'});if(epoch!==runEpoch||finalAccounts[0]?.toLowerCase()!==selectedAccount.toLowerCase()||BigInt(finalChain)!==1n)throw Error('Wallet changed. Reconnect and try again.');say(kind==='fee'?'Confirm in your wallet: 0.1% sell liquidity and 3.9% to the marketing receiver.':'Confirm in your wallet: marketing receiver '+newAddress);const tx=await fn(...args);submitted=true;output.replaceChildren();const link=document.createElement('a');link.href='https://etherscan.io/tx/'+tx.hash;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View submitted transaction ↗';output.append(link);say('Transaction submitted. Waiting for confirmation…');let receipt;try{receipt=await tx.wait(1,180000)}catch(e){if(e.code==='TRANSACTION_REPLACED'&&!e.cancelled){receipt=e.receipt;link.href='https://etherscan.io/tx/'+receipt.hash}else throw e}if(receipt?.status!==1)throw Error('Transaction reverted. No change was applied.');say('Transaction confirmed. Refreshing on-chain values…');if(epoch===runEpoch){await refresh();const verified=snapshot&&(kind==='fee'?(snapshot.liq===10n&&snapshot.mkt===390n):snapshot.receiver.toLowerCase()===newAddress.toLowerCase());say(verified?(kind==='fee'?'Sell tax confirmed: 0.1% liquidity, 3.9% to the marketing receiver. You can now update the receiver.':'Marketing receiver updated and verified on-chain.'):'Transaction confirmed. Refresh to verify the latest contract settings.',!verified)}else say('Transaction confirmed. Reconnect your wallet to read the latest state.')}catch(e){say((submitted?'Transaction was submitted; check its Etherscan link before retrying. ':'')+(e.code==='ACTION_REJECTED'?'Request cancelled in your wallet.':e.shortMessage||e.message),true)}finally{busy=false;render()}}

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
$('newReceiver').addEventListener('input',render);
$('setFee').addEventListener('click',()=>execute('fee'));
$('setReceiver').addEventListener('click',()=>execute('receiver'));
controller.start();render();refresh();
