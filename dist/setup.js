import {Contract,Interface,keccak256,ZeroAddress} from './ethers.js';
import {DEPLOYMENT as D} from './deployment.js';

export const TOKEN_ABI=Object.freeze([
  'function owner() view returns(address)','function _marketingWallet() view returns(address)',
  'function _sellFeeLiquidity() view returns(uint256)','function _sellFeeMarketing() view returns(uint256)','function _sellFeeTotal() view returns(uint256)',
  'function _buyFeeLiquidity() view returns(uint256)','function _buyFeeMarketing() view returns(uint256)','function _buyFeeTotal() view returns(uint256)',
  'function _isExcludedFromFees(address) view returns(bool)','function _uniswapV2Router() view returns(address)','function _WETH() view returns(address)',
  'function excludeFromFees(address account,bool excluded)','function setSellFee(uint256 liquidityFee,uint256 marketingFee)','function setMarketingWallet(address account)',
]);
const RECEIVER_ABI=['function owner() view returns(address)','function token() view returns(address)','function marketingWallet() view returns(address)','function router() view returns(address)','function weth() view returns(address)','function pair() view returns(address)','function buybacksPaused() view returns(bool)'];
const iface=new Interface(TOKEN_ABI);
function deadline(promise,ms,label){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms)})]).finally(()=>clearTimeout(timer));
}
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export const buyFees=s=>[s.buyLiq,s.buyMkt,s.buyTotal].map(String).join('/');
export function stepsFor(s){
  return Object.freeze([
    Object.freeze({key:'exempt',label:'Make receiver fee-exempt',fn:'excludeFromFees',args:Object.freeze([D.receiver,true]),done:!!s?.exempt}),
    Object.freeze({key:'fees',label:'Set sell fees to 0.1% + 3.9%',fn:'setSellFee',args:Object.freeze([D.sellLiquidityBps,D.sellReceiverBps]),done:!!s&&s.liq===10n&&s.mkt===390n&&s.total===400n}),
    Object.freeze({key:'receiver',label:'Set the marketing receiver',fn:'setMarketingWallet',args:Object.freeze([D.receiver]),done:!!s&&same(s.receiver,D.receiver)}),
  ]);
}
export function actionFor(s,key){
  const step=stepsFor(s).find(step=>step.key===key);
  if(!step)throw Error('Unsupported setup action.');
  if(!s?.verified)throw Error('Receiver or token verification failed. No transaction is available.');
  if(step.done)return null;
  if(stepsFor(s).find(step=>!step.done)?.key!==key)throw Error('Complete the earlier setup step first.');
  return step;
}
export async function readSetup(p){
  if(BigInt(await p.send('eth_chainId',[]))!==D.chainId)throw Error('Use Ethereum mainnet (chain ID 1).');
  const block=Number(BigInt(await p.send('eth_blockNumber',[]))),opts={blockTag:block};
  const [tokenCode,receiverCode]=await Promise.all([p.getCode(D.token,block),p.getCode(D.receiver,block)]);
  if(keccak256(tokenCode)!==D.tokenCodeHash||keccak256(receiverCode)!==D.receiverCodeHash)throw Error('Deployed contract code does not match the verified configuration. Setup is locked.');
  const t=new Contract(D.token,TOKEN_ABI,p),r=new Contract(D.receiver,RECEIVER_ABI,p);
  const names=['owner','_marketingWallet','_sellFeeLiquidity','_sellFeeMarketing','_sellFeeTotal','_buyFeeLiquidity','_buyFeeMarketing','_buyFeeTotal','_uniswapV2Router','_WETH'];
  const v=await Promise.all(names.map(name=>t[name](opts)));
  const receiverNames=['owner','token','marketingWallet','router','weth','pair','buybacksPaused'];
  const rv=await Promise.all(receiverNames.map(name=>r[name](opts)));
  const expected=[D.receiverOwner,D.token,D.payout,D.router,D.weth,D.pair];
  if(expected.some((address,index)=>!same(rv[index],address))||!same(v[8],D.router)||!same(v[9],D.weth))throw Error('Receiver ownership or immutable destinations differ from the verified configuration. Setup is locked.');
  if(v[4]!==v[2]+v[3]||v[7]!==v[5]+v[6])throw Error('Token fee totals are inconsistent. Setup is locked.');
  if(!same(v[1],D.payout)&&!same(v[1],D.receiver))throw Error('The token marketing destination changed unexpectedly. Review its live state before setup.');
  if(rv[6])throw Error('Receiver buybacks are paused. Ask the receiver owner to review its state before activation.');
  return Object.freeze({verified:true,block,owner:v[0],receiver:v[1],liq:v[2],mkt:v[3],total:v[4],buyLiq:v[5],buyMkt:v[6],buyTotal:v[7],exempt:await t._isExcludedFromFees(D.receiver,opts),payout:rv[2]});
}
export function createEthereumAdapter({getSession,getProvider}){
  const provider=()=>{const p=getProvider();if(!p)throw Error('Connect an Ethereum wallet first.');return p};
  return{
    session:getSession,
    read:()=>deadline(readSetup(provider()),25000,'Ethereum verification timed out. Refresh and review before continuing.'),
    async identity(session,snapshot){
      const current=getSession();
      if(!current?.wallet||!session?.wallet||current.revision!==session.revision||current.wallet!==session.wallet||!same(current.account,session.account))throw Error('Wallet changed. Review this step again.');
      const [chain,accounts]=await deadline(Promise.all([current.wallet.request({method:'eth_chainId'}),current.wallet.request({method:'eth_accounts'})]),15000,'Wallet identity check timed out. Open your wallet and review again.');
      if(BigInt(chain)!==1n)throw Error('Use Ethereum mainnet (chain ID 1).');
      if(!same(accounts?.[0],session.account)||!same(snapshot.owner,session.account)||same(snapshot.owner,ZeroAddress))throw Error('Only the current ZYPTO token owner can configure these settings.');
      if(getSession().revision!==session.revision)throw Error('Wallet changed. Review this step again.');
    },
    async quote(step,session){
      const p=provider();
      const tx={from:session.account,to:D.token,data:iface.encodeFunctionData(step.fn,step.args),value:0n,chainId:1n};
      await deadline(p.call(tx),20000,'Transaction simulation timed out. No transaction was requested.'); // eth_call only.
      const estimate=await deadline(p.estimateGas(tx),20000,'Gas estimation timed out. No transaction was requested.'),fees=await deadline(p.getFeeData(),15000,'Network fee lookup timed out. Review again.');
      const gasLimit=(estimate*120n+99n)/100n;
      if(estimate<=0n||gasLimit>2000000n)throw Error('Unexpected gas estimate. No transaction will be requested.');
      let feeFields,price;
      if(fees.maxFeePerGas!=null&&fees.maxPriorityFeePerGas!=null){
        price=fees.maxFeePerGas;
        if(price<=0n||fees.maxPriorityFeePerGas<0n||fees.maxPriorityFeePerGas>price)throw Error('Invalid Ethereum fee estimate. Refresh and review again.');
        feeFields={maxFeePerGas:price,maxPriorityFeePerGas:fees.maxPriorityFeePerGas};
      }else if(fees.gasPrice!=null&&fees.gasPrice>0n){price=fees.gasPrice;feeFields={gasPrice:price}}
      else throw Error('Ethereum gas fees are unavailable. Refresh and review again.');
      const maxGasCost=gasLimit*price;
      const balance=await deadline(p.getBalance(session.account,'pending'),15000,'Owner ETH balance lookup timed out. Review again.');
      if(balance<maxGasCost)throw Error('The owner wallet needs more ETH for the estimated maximum network fee. No ETH is sent to the token contract.');
      return Object.freeze({tx:Object.freeze({...tx,gasLimit,...feeFields}),maxGasCost,balance});
    },
    async send(review){const signer=await deadline(provider().getSigner(review.session.account),15000,'Wallet signer request timed out. Check wallet activity before retrying.');await this.identity(review.session,review.snapshot);return deadline(signer.sendTransaction(review.quote.tx),180000,'Wallet response timed out. Check wallet activity before reloading or submitting anything else.')},
    receipt:hash=>provider().waitForTransaction(hash,1,120000),
    checkReceipt:hash=>provider().getTransactionReceipt(hash),
    transaction:hash=>provider().getTransaction(hash),
  };
}
export function createSetupFlow(adapter,{onChange=()=>{},now=()=>Date.now()}={}){
  let state={phase:'idle',snapshot:null,review:null,hash:null,message:'Connect the token owner wallet to review the next step.',error:false};
  let generation=0,inflight=null;
  const publish=patch=>{state={...state,...patch};onChange(Object.freeze({...state}));return state};
  const busy=()=>['loading','preparing','wallet','pending'].includes(state.phase);
  const assertCurrent=(run,session)=>{if(run!==generation||adapter.session()?.revision!==session.revision)throw Error('Wallet or setup state changed. Review this step again.')};
  const message=e=>e?.shortMessage||e?.message||'Setup stopped. Refresh and review before trying again.';
  async function refresh(){
    if(busy())return;
    if(state.phase==='uncertain')return recheck();
    const run=++generation;publish({phase:'loading',review:null,error:false,message:'Checking Ethereum contracts and current settings…'});
    try{const snapshot=await adapter.read();if(run!==generation)return;publish({phase:'idle',snapshot,message:stepsFor(snapshot).every(s=>s.done)?'Setup is already complete. No transaction is needed.':'Live settings checked. Review the next required step.'})}
    catch(e){if(run===generation)publish({phase:'error',snapshot:null,error:true,message:message(e)})}
  }
  async function prepare(key){
    if(busy()||state.phase==='uncertain')return false;
    const run=++generation,session=adapter.session();
    publish({phase:'preparing',review:null,hash:null,error:false,message:'Checking ownership, destinations and gas…'});
    try{
      const snapshot=await adapter.read();await adapter.identity(session,snapshot);assertCurrent(run,session);
      const step=actionFor(snapshot,key);
      if(!step){publish({phase:'idle',snapshot,message:'This step is already satisfied. No transaction was requested.'});return false}
      const quote=await adapter.quote(step,session);assertCurrent(run,session);
      const review=Object.freeze({step,session:Object.freeze({...session}),snapshot,quote,expiresAt:now()+120000});
      publish({phase:'review',snapshot,review,message:'Review this exact call, then choose Confirm in wallet. Nothing has been sent.'});return true;
    }catch(e){if(run===generation)publish({phase:'error',review:null,error:true,message:message(e)});return false}
  }
  async function verifyReceipt(receipt){
    if(!receipt)throw Error('Confirmation is not available yet. Check the transaction before retrying.');
    if(receipt.status!==1){inflight=null;throw Error('The transaction reverted. Setup stopped; no next step was requested.')}
    const transaction=await adapter.transaction(state.hash);
    if(!transaction||!same(transaction.to,D.token)||!same(transaction.from,inflight.session.account)||transaction.data.toLowerCase()!==inflight.quote.tx.data.toLowerCase()||BigInt(transaction.value)!==0n||BigInt(transaction.chainId)!==1n)throw Error('The confirmed transaction does not match the reviewed call. Setup stopped for review.');
    const snapshot=await adapter.read();
    if(!stepsFor(snapshot).find(s=>s.key===inflight.step.key)?.done)throw Error('Receipt confirmed, but the expected setting is not present. Setup stopped.');
    if(buyFees(snapshot)!==buyFees(inflight.snapshot))throw Error('Buy fees changed during setup. Setup stopped for review.');
    inflight=null;
    publish({phase:'success',snapshot,review:null,error:false,message:'Transaction confirmed and setting verified. Review the next step separately.'});
    return true;
  }
  async function confirm(){
    if(state.phase!=='review'||!state.review)return false;
    const review=state.review,run=++generation;
    publish({phase:'preparing',review:null,error:false,message:'Rechecking this call immediately before wallet confirmation…'});
    let requested=false;
    try{
      if(now()>review.expiresAt)throw Error('This review expired. Review the step again for fresh gas and state.');
      const snapshot=await adapter.read();await adapter.identity(review.session,snapshot);assertCurrent(run,review.session);
      const step=actionFor(snapshot,review.step.key);
      if(!step){publish({phase:'idle',snapshot,message:'This step was already completed elsewhere. No transaction was requested.'});return false}
      if(buyFees(snapshot)!==buyFees(review.snapshot))throw Error('Buy fees changed since review. Review the live settings again.');
      const quote=await adapter.quote(step,review.session);assertCurrent(run,review.session);
      if(quote.maxGasCost>review.quote.maxGasCost||quote.tx.gasLimit>review.quote.tx.gasLimit)throw Error('The gas estimate increased. Review the updated estimate before confirming.');
      if(quote.balance<review.quote.maxGasCost)throw Error('The owner ETH balance fell below the reviewed maximum network fee. Review again after funding gas.');
      if((quote.tx.maxFeePerGas??quote.tx.gasPrice)>(review.quote.tx.maxFeePerGas??review.quote.tx.gasPrice)||('gasPrice' in quote.tx)!==('gasPrice' in review.quote.tx))throw Error('Network fee pricing changed. Review the updated estimate.');
      await adapter.identity(review.session,snapshot);assertCurrent(run,review.session);
      inflight={...review,snapshot};
      publish({phase:'wallet',message:'Confirm this one transaction in your wallet. No later step will be sent automatically.'});
      requested=true;
      const tx=await adapter.send(review);
      if(!/^0x[0-9a-fA-F]{64}$/.test(tx?.hash||''))throw Error('Wallet response has no transaction hash. Check wallet activity before retrying.');
      publish({phase:'pending',hash:tx.hash,message:'Transaction submitted. Waiting for one Ethereum confirmation…'});
      return await verifyReceipt(await adapter.receipt(tx.hash));
    }catch(e){
      if(run!==generation&&!requested)return false;
      const rejected=e?.code==='ACTION_REJECTED'||e?.code===4001||e?.info?.error?.code===4001;
      const uncertain=requested&&!rejected&&inflight!==null;
      if(!uncertain)inflight=null;
      publish({phase:uncertain?'uncertain':'error',review:null,error:true,message:rejected?'Transaction cancelled in your wallet. Setup stopped; no later transaction was requested.':message(e)});return false;
    }
  }
  async function recheck(){
    if(state.phase!=='uncertain'||!state.hash||!inflight){if(state.phase==='uncertain')publish({message:'The wallet outcome is unknown. Check wallet activity before reloading or submitting anything else.',error:true});return false}
    try{return await verifyReceipt(await adapter.checkReceipt(state.hash))}
    catch(e){publish({phase:inflight?'uncertain':'error',error:true,message:message(e)});return false}
  }
  return{
    getState:()=>Object.freeze({...state}),refresh,prepare,confirm,recheck,
    cancel(){if(state.phase==='review'){generation++;publish({phase:'idle',review:null,message:'Review cancelled. Nothing was sent.'})}},
    invalidate(){generation++;publish({snapshot:null,review:null,...(['wallet','pending','uncertain'].includes(state.phase)?{}:{phase:'idle'}),message:'Wallet changed. Reconnect to Ethereum and review live settings before continuing.'})},
  };
}
