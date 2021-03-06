pragma solidity ^0.8.9;
// SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @dev TokenWithdraw implementation
 *
 * Emergency functions to withdraw tokens
 *
 */
contract TokenWithdraw is AccessControl {
  using SafeERC20 for IERC20;

  constructor() {
    _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  ///@dev Withdraw function to avoid locking tokens in the contract
  function withdrawERC20(IERC20 _token, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _token.safeTransfer(msg.sender, _amount);
  }

  ///@dev Emergency method to withdraw NFT in case someone sends..
  function withdrawNFT(IERC721 _token, uint256 _tokenId) external onlyRole(DEFAULT_ADMIN_ROLE) {
    _token.safeTransferFrom(address(this), msg.sender, _tokenId);
  }
}