// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import '../contracts/ZyptoFeeReceiver.sol';
contract MockAsset {
 mapping(address=>uint256) public balanceOf;
 function mint(address a,uint256 v) external {balanceOf[a]+=v;}
 function transfer(address to,uint256 v) external returns(bool){balanceOf[msg.sender]-=v;balanceOf[to]+=v;return true;}
}
contract MockToken is MockAsset {
 address public owner;address public _marketingWallet;address public _uniswapV2Router;address public _WETH;
 mapping(address=>bool) public _isExcludedFromFees;
 constructor(address o,address m,address r,address w){owner=o;_marketingWallet=m;_uniswapV2Router=r;_WETH=w;}
 function exclude(address a,bool b) external {_isExcludedFromFees[a]=b;}
}
contract MockFactory {
 mapping(address=>mapping(address=>address)) public getPair;
 function setPair(address a,address b,address p) external {getPair[a][b]=p;getPair[b][a]=p;}
}
contract MockPair {
 address public factory;address public token0;address public token1;
 uint112 private reserve0;uint112 private reserve1;uint32 private timestamp;
 constructor(address f,address a,address b){factory=f;token0=a;token1=b;}
 function setReserves(uint112 a,uint112 b,uint32 t) external {reserve0=a;reserve1=b;timestamp=t;}
 function getReserves() external view returns(uint112,uint112,uint32){return(reserve0,reserve1,timestamp);}
}
contract MockRouter {
 address public WETH;MockToken public token;uint256 public mode;MockFactory public factory;
 uint256 public quoteMode;uint256 public executionBps=10_000;
 address public lastPair;uint256 public lastMinimum;
 constructor(address w){WETH=w;factory=new MockFactory();}
 function configure(address t,uint256 m) external{token=MockToken(t);mode=m;}
 function setFactory(address f) external {factory=MockFactory(f);}
 function setQuoteMode(uint256 m) external {quoteMode=m;}
 function setExecutionBps(uint256 bps) external {executionBps=bps;}
 function _quote(uint256 amount,address[] calldata path) private view returns(uint256){
  require(path.length==2 && path[0]==WETH && path[1]==address(token),'wrong path');
  MockPair pool=MockPair(factory.getPair(path[0],path[1]));
  (uint112 a,uint112 b,)=pool.getReserves();
  (uint256 rin,uint256 rout)=pool.token0()==WETH?(uint256(a),uint256(b)):(uint256(b),uint256(a));
  require(rin>0 && rout>0,'empty reserves');uint256 fee=amount*997;
  return fee*rout/(rin*1000+fee);
 }
 function getAmountsOut(uint256 amount,address[] calldata path) external view returns(uint256[] memory a){
  if(quoteMode==1) revert('quote failed');
  a=new uint256[](quoteMode==2?1:quoteMode==6?3:2);a[0]=quoteMode==4?amount+1:amount;
  if(a.length>1)a[1]=quoteMode==3?0:_quote(amount,path)+(quoteMode==5?1:0);
 }
 function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 min,address[] calldata path,address to,uint256) external payable{
  if(mode==1) revert('simulated swap failure');
  if(mode==2){while(true){assembly {pop(gas())}}}
  if(mode==3){token.mint(to,1);return;}
  if(mode==4){(bool success,)=to.call(abi.encodeWithSignature('process()'));require(!success,'reentry');}
  uint256 output=_quote(msg.value,path)*executionBps/10_000;
  require(output>=min,'minimum output');lastPair=factory.getPair(path[0],path[1]);lastMinimum=min;
  token.mint(to,output);
 }
}
contract MockMarketing {
 uint256 public mode;address public target;
 function configure(uint256 m,address t) external{mode=m;target=t;}
 receive() external payable{
  if(mode==1) revert('reject ETH');
  if(mode==2){while(true){assembly {pop(gas())}}}
  if(mode==3){(bool ok,)=target.call(abi.encodeWithSignature('process()'));require(!ok,'reentry');}
 }
}
contract TestReceiver is FeeReceiverCore {
 constructor(address t,uint256 threshold,address p) FeeReceiverCore(t,threshold,p){}
}
contract ForceETH {constructor() payable{}function force(address payable to) external {selfdestruct(to);}}

// WETH9-style deposit/allowance/withdraw behavior, including 2,300-gas transfer.
// Adversarial modes are test-only and cannot be configured on mainnet WETH9.
contract MockWETHRelay {
 function forward(address payable to) external payable { (bool ok,)=to.call{value:msg.value}(""); require(ok,"callback rejected"); }
}
contract MockWETH {
 MockWETHRelay private relay = new MockWETHRelay();
 mapping(address=>uint256) public balanceOf;
 mapping(address=>mapping(address=>uint256)) public allowance;
 uint256 public mode;
 function configure(uint256 m) external { mode=m; }
 function deposit() external payable {balanceOf[msg.sender]+=msg.value;}
 function approve(address to,uint256 amount) external returns(bool){allowance[msg.sender][to]=amount;return true;}
 function transfer(address to,uint256 amount) external returns(bool){balanceOf[msg.sender]-=amount;balanceOf[to]+=amount;return true;}
 function transferFrom(address from,address to,uint256 amount) external returns(bool){
  if(mode==3) return false;
  allowance[from][msg.sender]-=amount;balanceOf[from]-=amount;balanceOf[to]+=amount;
  if(mode==4){(bool ok,)=to.call(abi.encodeWithSignature("process()"));require(!ok,"reentrant process");}
  return true;
 }
 function withdraw(uint256 amount) external {
  if(mode==1) revert("unwrap failure");
  if(mode==5){while(true){assembly {pop(gas())}}}
  if(mode==6){balanceOf[msg.sender]-=amount;relay.forward{value:amount}(payable(msg.sender));return;}
  balanceOf[msg.sender]-=amount;
  if(mode==2){payable(msg.sender).transfer(amount-1);return;}
  if(mode==4){(bool ok,)=msg.sender.call(abi.encodeWithSignature("process()"));require(!ok,"reentrant process");}
  payable(msg.sender).transfer(amount);
 }
}
