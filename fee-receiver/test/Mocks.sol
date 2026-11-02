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
