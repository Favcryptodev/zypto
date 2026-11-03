// Local browser QA only. Generated HTML is ignored and must never be published.
// The mock wallet exposes a public owner address, proxies reads only, supplies a
// mock ETH balance/gas estimate, and rejects every transaction request locally.
import {readFileSync,writeFileSync} from 'node:fs';
import {DEPLOYMENT} from '../dist/deployment.js';
const bootstrap=`<script>
window.__qaRequests=[];
const reads=new Set(['eth_call','eth_getCode','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionCount','eth_gasPrice','eth_maxPriorityFeePerGas','eth_getTransactionReceipt','eth_getTransactionByHash']);
window.ethereum={on(){},removeListener(){},async request({method,params=[]}){
 window.__qaRequests.push(method);
 if(method==='eth_requestAccounts'||method==='eth_accounts')return ['${DEPLOYMENT.receiverOwner}'];
 if(method==='eth_chainId')return '0x1';
 if(method==='eth_getBalance')return '0x8ac7230489e80000';
 if(method==='eth_estimateGas')return '0xc350';
 if(method==='eth_sendTransaction')throw Object.assign(Error('Rejected by local QA mock'),{code:4001});
 if(!reads.has(method))throw Object.assign(Error('QA blocked method '+method),{code:4200});
 const response=await fetch('https://ethereum-rpc.publicnode.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 const value=await response.json();if(value.error)throw Object.assign(Error(value.error.message),value.error);return value.result;
}};
</script>`;
const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8').replace('<script type="module"',bootstrap+'<script type="module"');
writeFileSync(new URL('../dist/__qa-owner.html',import.meta.url),html);
console.log('Created local-only owner mock; transactions are rejected and never forwarded.');
