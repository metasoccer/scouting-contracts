pragma solidity ^0.8.9;
// SPDX-License-Identifier: MIT

///@dev The interface we couple Scouts contract to
interface IEntropyManager {
  function requestEntropy(address _address, uint256 _tokenId, uint256 _index) external;
}