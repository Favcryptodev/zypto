import {BrowserProvider,JsonRpcProvider,FetchRequest,formatEther,formatUnits} from './ethers.js';
import {createWalletController} from './wallet.js';
import {DEPLOYMENT as D} from './deployment.js';
import {createSetupFlow,createEthereumAdapter,stepsFor} from './setup.js';

const $=id=>document.getElementById(id);
const same=(a,b)=>a?.toLowerCase()===b?.toLowerCase();
const pct=n=>Number(n)/100+'%';
const endpoints=['https://ethereum-rpc.publicnode.com','https://eth.drpc.org'];
let publicIndex=0,revision=0,walletProvider=null,connection={status:'idle'},view={phase:'idle'},lastReview=null;
function makePublic(index){const req=new FetchRequest(endpoints[index]);req.timeout=12000;return new JsonRpcProvider(req,1,{staticNetwork:true,batchMaxCount:1})}
let publicProvider=makePublic(0);
const getSession=()=>({revision,account:connection.status==='connected'?connection.account:null,wallet:connection.status==='connected'?connection.provider:null});
const adapter=createEthereumAdapter({getSession,getProvider:()=>walletProvider||publicProvider});
// Confirmation monitoring stays on Ethereum mainnet even if the wallet changes networks.
adapter.receipt=hash=>publicProvider.waitForTransaction(hash,1,120000);
adapter.checkReceipt=hash=>publicProvider.getTransactionReceipt(hash);
adapter.transaction=hash=>publicProvider.getTransaction(hash);
const flow=createSetupFlow(adapter,{onChange(state){view=state;if(state.review)lastReview=state.review;render()}});

function render(){
  const s=view.snapshot;
  const owner=!!(s?.verified&&connection.status==='connected'&&same(connection.account,s.owner));
  const busy=['loading','preparing','wallet','pending'].includes(view.phase);
  const uncertain=view.phase==='uncertain';
  const steps=stepsFor(s),next=steps.find(step=>!step.done);
  $('configuredReceiver').textContent=D.receiver;
  $('configuredReceiver').href='https://etherscan.io/address/'+D.receiver+'#code';
  $('fixedPayout').textContent=D.payout;
  $('deploymentState').textContent=s?.verified?'Contract code and destinations verified':'Verification required';
  $('owner').textContent=s?.owner||'Unavailable';
  $('receiver').textContent=s?.receiver||'Unavailable';
  $('liq').textContent=s?pct(s.liq):'—';$('mkt').textContent=s?pct(s.mkt):'—';$('total').textContent=s?pct(s.total):'—';
  $('buy').textContent=s?pct(s.buyLiq)+' liquidity / '+pct(s.buyMkt)+' marketing (unchanged)':'Unavailable';
  $('readState').textContent=s?'Ethereum mainnet · verified at block '+s.block.toLocaleString():busy?'Checking deployed code and token settings…':'Refresh to verify Ethereum contract state.';
  for(const step of steps){
    $('step-'+step.key).textContent=!s?'Not checked':step.done?'Already satisfied':next?.key===step.key?'Next step':'After earlier steps';
  }
  $('update').disabled=!owner||!s?.verified||busy||uncertain||view.phase==='review'||!next;
  $('update').textContent=s&&!next?'Setup complete':'Review next step';
  $('actionLock').textContent=uncertain?'Transaction outcome is uncertain. Check its status before any further setup.':!s?'Setup is locked until contract verification succeeds.':!owner?'Connect the current token owner wallet on Ethereum to configure these settings.':!next?'All three settings are already correct. No transaction is needed.':'Next: '+next.label+'. Values are prefilled; each step requires a separate wallet confirmation.';
  $('refresh').disabled=busy;
  $('refresh').textContent=uncertain?'Check transaction':'Refresh';
  const connecting=connection.status==='connecting';
  $('connect').disabled=connecting||['wallet','pending','preparing'].includes(view.phase);
  $('connect').textContent=connecting?'Connecting…':connection.status==='wrong-network'?'Switch to Ethereum':connection.status==='connected'?'Reconnect wallet':'Connect wallet';
  $('connect').setAttribute('aria-busy',String(connecting));
  $('disconnect').hidden=!connection.account&&!connecting&&connection.status!=='wrong-network';
  $('walletSelect').disabled=connecting||!!connection.account||busy;
  $('findWallets').disabled=connecting||busy;
  $('walletState').textContent=connection.error||(connecting?'Open your wallet and approve account access. Connecting does not sign or send a transaction.':connection.status==='connected'?connection.walletName+' · '+connection.account+' · Ethereum mainnet. '+(owner?'Token owner verified.':'Read-only until current token ownership is verified.'):'Choose a browser wallet extension or open this page inside your wallet’s in-app browser. QR pairing is not enabled.');
  $('walletState').classList.toggle('error',connection.status==='error'||connection.status==='wrong-network');
  $('status').textContent=view.message||'Checking Ethereum…';$('status').classList.toggle('error',!!view.error);
  $('status').setAttribute('aria-busy',String(busy));
  $('review').hidden=!lastReview;
  if(lastReview){
    const {step,session,quote,snapshot}=lastReview,tx=quote.tx;
    $('reviewAction').textContent=step.label;
    $('reviewFrom').textContent=session.account;
    $('reviewTo').textContent=D.token;
    $('reviewCall').textContent=step.fn+'('+step.args.map(String).join(', ')+')';
    $('reviewData').textContent=tx.data;
    $('reviewGas').textContent=String(tx.gasLimit)+' gas (20% estimate buffer)';
    $('reviewPrice').textContent=tx.maxFeePerGas!=null?'Max '+formatUnits(tx.maxFeePerGas,'gwei')+' gwei/gas; priority '+formatUnits(tx.maxPriorityFeePerGas,'gwei')+' gwei':formatUnits(tx.gasPrice,'gwei')+' gwei/gas';
    $('reviewCost').textContent=formatEther(quote.maxGasCost)+' ETH maximum network fee';
    $('reviewBuy').textContent=pct(snapshot.buyLiq)+' liquidity / '+pct(snapshot.buyMkt)+' marketing; no buy-fee call is sent.';
  }
  $('confirm').disabled=view.phase!=='review';$('cancel').disabled=view.phase!=='review';
  $('txLink').hidden=!view.hash;
  if(view.hash){$('txLink').href='https://etherscan.io/tx/'+view.hash;$('txLink').textContent='View transaction '+view.hash}
}
async function refresh(){
  await flow.refresh();
  if(!walletProvider&&publicIndex===0&&flow.getState().phase==='error'){
    publicProvider.destroy();publicProvider=makePublic(++publicIndex);await flow.refresh();
  }
}
const wallets=createWalletController({
  window,
  onProviders(choices){
    const select=$('walletSelect'),selected=select.value;select.replaceChildren();
    if(!choices.length){const option=document.createElement('option');option.value='';option.textContent='No wallet detected';select.append(option)}
    for(const choice of choices){const option=document.createElement('option');option.value=choice.id;option.textContent=choice.name;select.append(option)}
    if(choices.some(choice=>choice.id===selected))select.value=selected;render();
  },
  onState(next){
    connection=next;revision++;
    const previous=walletProvider;walletProvider=next.status==='connected'?new BrowserProvider(next.provider):null;
    previous?.destroy();flow.invalidate();render();
    if(!['wallet','pending','uncertain'].includes(view.phase))refresh();
  },
});
$('connect').addEventListener('click',()=>wallets.connect($('walletSelect').value));
$('disconnect').addEventListener('click',()=>wallets.disconnect('Disconnected from this page. Wallet site permissions remain controlled by your wallet.'));
$('findWallets').addEventListener('click',()=>wallets.discover());
$('refresh').addEventListener('click',refresh);
$('update').addEventListener('click',async()=>{
  const next=stepsFor(view.snapshot).find(step=>!step.done);
  if(next&&await flow.prepare(next.key))$('reviewHeading').focus();
});
$('confirm').addEventListener('click',()=>flow.confirm());
$('cancel').addEventListener('click',()=>flow.cancel());
wallets.start();render();refresh();
