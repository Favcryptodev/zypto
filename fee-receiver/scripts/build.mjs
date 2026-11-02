import solc from 'solc';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
export function compile(extra={}) {
 const input={language:'Solidity',sources:{'contracts/ZyptoFeeReceiver.sol':{content:readFileSync('contracts/ZyptoFeeReceiver.sol','utf8')},...extra},settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
 const output=JSON.parse(solc.compile(JSON.stringify(input)));
 for(const e of output.errors||[])if(e.severity==='error')throw Error(e.formattedMessage);
 return {input,output};
}
if(process.argv[1]?.endsWith('/build.mjs')){
 const {input,output}=compile();const c=output.contracts['contracts/ZyptoFeeReceiver.sol'].ZyptoFeeReceiver;
 mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/ZyptoFeeReceiver.json',JSON.stringify({contractName:'ZyptoFeeReceiver',compiler:solc.version(),abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object},null,2));writeFileSync('artifacts/standard-input.json',JSON.stringify(input,null,2));console.log('Compiled Solidity '+solc.version()+'; runtime '+c.evm.deployedBytecode.object.length/2+' bytes.');
}
