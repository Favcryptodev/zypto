import ganache from 'ganache';import {BrowserProvider,ContractFactory,parseEther as eth,ZeroAddress} from 'ethers';import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {compile} from '../scripts/build.mjs';
const {output}=compile({'test/Mocks.sol':{content:readFileSync('test/Mocks.sol','utf8')}});const g=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'},wallet:{totalAccounts:5}});const p=new BrowserProvider(g);p.pollingInterval=20;const deployer=await p.getSigner(0),owner=await p.getSigner(1),stranger=await p.getSigner(2);const results=[];
async function deploy(n,args=[],value=0n){const c=output.contracts['test/Mocks.sol'][n];const d=await new ContractFactory(c.abi,c.evm.bytecode.object,deployer).deploy(...args,{value});await d.waitForDeployment();return d;}
async function tx(p){return (await p).wait();}async function fails(fn){await assert.rejects(fn);}async function pass(name,fn){await fn();results.push(name);console.log('PASS '+name);}
const w=await deploy('MockAsset'),m=await deploy('MockMarketing'),r=await deploy('MockRouter',[w.target]),t=await deploy('MockToken',[await owner.getAddress(),m.target,r.target,w.target]);const c=await deploy('TestReceiver',[t.target,eth('1'),eth('900')]);await tx(r.configure(t.target,0));await tx(t.exclude(c.target,true));
const send=amount=>tx(deployer.sendTransaction({to:c.target,value:eth(amount),gasLimit:1_400_000}));const process=()=>tx(c.process({gasLimit:1_400_000}));const bal=addr=>g.request({method:'eth_getBalance',params:[addr,'latest']}).then(BigInt);const invariant=async()=>assert.equal(await c.marketingPending()+await c.burnPending(),await bal(c.target));
// Additional review regression: ordinary ERC20 transfers never call ETH receive().
try {
 const before=await c.totalReceived();
 await tx(w.mint(await deployer.getAddress(),eth('4')));
 await tx(w.transfer(c.target,eth('4')));
 assert.equal(await w.balanceOf(c.target),eth('4'));
 assert.equal(await c.totalReceived(),before);
 assert.equal(await c.marketingPending(),0n);
 assert.equal(await c.burnPending(),0n);
 await process();
 assert.equal(await w.balanceOf(c.target),eth('4'));
 assert.equal(await c.totalReceived(),before);
 assert.equal(await bal(m.target),0n);
 assert.equal(await t.balanceOf(await c.BURN_ADDRESS()),0n);
 console.log('PASS: WETH-like ordinary ERC20 receipt does not account, split, unwrap or burn, even after process().');
} finally { await g.disconnect(); }
