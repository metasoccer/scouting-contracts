pragma solidity ^0.8.9;
// SPDX-License-Identifier: MIT

///@dev The interface we couple Scouts contract to
interface IPlayersIdGenerator {
  function getPlayerId(uint256 _minterType, uint256 _minterId, uint256 _totalSupply) pure external returns (uint256);
}