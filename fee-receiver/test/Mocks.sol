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
contract MockRouter {
 address public WETH;MockToken public token;uint256 public mode;uint256 public rate=1000;
 constructor(address w){WETH=w;}
 function configure(address t,uint256 m) external{token=MockToken(t);mode=m;}
 function getAmountsOut(uint256 amount,address[] calldata) external view returns(uint256[] memory a){a=new uint256[](2);a[0]=amount;a[1]=amount*rate;}
 function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 min,address[] calldata,address to,uint256) external payable{
  if(mode==1) revert('simulated swap failure');
  if(mode==2){while(true){assembly {pop(gas())}}}
  if(mode==3){token.mint(to,1);return;}
  if(mode==4){(bool success,)=to.call(abi.encodeWithSignature('process()'));require(!success,'reentry');}
  require(msg.value*rate>=min,'price floor');token.mint(to,msg.value*rate);
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
 constructor(address t,uint256 threshold,uint256 floor) FeeReceiverCore(t,threshold,floor){}
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
