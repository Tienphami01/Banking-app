// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract VaultManager is Ownable, Pausable {


    IERC20 public immutable token;

    // địa chỉ nhận phí khi user rút tiền sớm 
    address public feeReceiver;

    // địa chỉ rút tiền
    address public savingCore;

    // event

    event VaultFunded(address indexed by, uint256 amount);
    event VaultWithdrawn(address indexed by, uint256 amount);
    event FeeReceiverUpdated(address indexed newReceiver);
    event SavingCoreUpdated(address indexed newcore);

    // error
    error NotSavingCore();
    error InsufficientVaultBalance();
    error ZeroAddress();
    error ZeroAmount();

    constructor(address _token, address _feeReceiver) Ownable(msg.sender) {
        if(_token == address(0)) revert ZeroAddress(); 
        if(_feeReceiver == address(0)) revert ZeroAddress();

        token = IERC20(_token);
        feeReceiver = _feeReceiver;
    }

    modifier onlySavingCore() { // chỉ savingCore mới gọi được hàm này 
        if (msg.sender != savingCore) revert NotSavingCore();
            _;
        

    }
       

         // admin nạp tiền vào vault để trả lãi
    function fundVault(uint256 amount) external onlyOwner {
            if(amount == 0 ) revert ZeroAmount();
            // đưa token từ ví admin vào contracts 
            token.transferFrom(msg.sender, address(this), amount);
            emit VaultFunded(msg.sender, amount);


    }

        // admin rút tiền ra khỏi ví 
    function withdrawVault(uint256 amount) external onlyOwner {
            if (amount == 0) revert ZeroAmount();
            if (token.balanceOf(address(this)) < amount) revert InsufficientVaultBalance();
            token.transfer(msg.sender, amount);
            emit VaultWithdrawn(msg.sender, amount);

    }

        // cập nhật địa chỉ nhận phí
    function setfeeReceiver(address _feeReceiver) external onlyOwner {
            if (_feeReceiver == address(0)) revert ZeroAddress();
            feeReceiver = _feeReceiver;
            emit FeeReceiverUpdated(_feeReceiver);
    }        

        // liên kết SavingCore với Vault

    function setSavingCore(address _savingCore) external onlyOwner {
            if (_savingCore == address(0)) revert ZeroAddress();
            savingCore = _savingCore;
            emit SavingCoreUpdated(_savingCore);

    }

        /// dừng khẩn cấp
        
    function pause() external onlyOwner { _pause();}
    function unpause() external onlyOwner { _unpause(); }

        // core function, được gọi bởi SavingCore

        /// trả lãi cho user
    function payInterest(
            address to,
            uint256 amount

    ) external onlySavingCore whenNotPaused {
            if (token.balanceOf(address(this)) < amount) revert InsufficientVaultBalance();
            token.transfer(to, amount);

    }

        // chuyển phí rút sớm đến feeReceiver
    function collectFee(uint256 amount) external onlySavingCore whenNotPaused {
            token.transfer(feeReceiver, amount);

    }

        /// xem số dư hiện tại của sVault

    function vaultBalance() external view returns (uint256) {
            return token.balanceOf(address(this));
    }

    
    
}
