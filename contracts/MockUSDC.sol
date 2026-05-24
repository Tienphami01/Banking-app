// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockUSDC is ERC20, Ownable {

  constructor() ERC20("Mock USDC", "mUSDC") Ownable(msg.sender) {
    _mint(msg.sender, 1_000_000 * 10 ** decimals());
  }
  
  function decimals() public pure override returns (uint8) {
    return 6;
  }


  function mint(address to, uint amount) external onlyOwner {
    _mint(to, amount);
  }

}