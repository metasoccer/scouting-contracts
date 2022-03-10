pragma solidity ^0.8.9;
// SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBase.sol";
import "./EntropyStorage.sol";
import "./IEntropyManager.sol";
import "./TokenWithdraw.sol";

/**
* @dev EntropyManager implementation
*
* This contract inherits VRFConsumerBase and
* manages entropy requests for EntropyStorage source
* 
* Network: Mumbai
* Chainlink VRF Coordinator address: 0x8C7382F9D8f56b33781fE506E897a4F1e2d17255
* LINK token address:                0x326C977E6efc84E512bB9C30f76E30c160eD06FB
* Key Hash: 0x6e75b569a01ef56d18cab6a8e71e6600d6ce853834d4a5748b720d06f878b3a4
* 
* Network: BSC Testnet
* Chainlink VRF Coordinator address: 0xa555fC018435bef5A13C6c6870a9d4C11DEC329C
* LINK token address:                0x84b9B910527Ad5C03A9Ca831909E21e236EA7b06
* Key Hash: 0xcaf3c3727e033261d383b315559476f48034c13b18f8cafed4d871abe5049186
*/

contract EntropyManager is IEntropyManager, VRFConsumerBase, TokenWithdraw {

  event EntropyRequested(address indexed targetAddress, uint256 indexed tokenId, uint256 indexed index, bytes32 requestID);
  event EntropyReceived(address indexed targetAddress, uint256 indexed tokenId, uint256 indexed index, uint256 value);

  bytes32 public constant REQUESTER_ROLE = keccak256("REQUESTER_ROLE");
  bytes32 public immutable VRFKey;
  uint256 public immutable VRFFee;

  struct Request {
    bool    finished;
    bool    requested;
    address targetAddress;
    uint256 tokenId;
    uint256 index;
    uint256 value;
  }

  // Mapping from address to tokenId to index to actual entropy value
  mapping(bytes32 => Request) public entropyRequests;

  /// @dev Maps each request to the tuple 721 contract + token + index
  /// Used to only allow 1 request per token as indicated in
  /// https://docs.chain.link/docs/vrf-security-considerations/
  mapping(
    address => mapping(
      uint256 => mapping(uint256 => Request)
    )
  ) public tokenEntropyRequest;

  constructor(address _VRFCoordinator, bytes32 _VRFKey, address _linkToken, uint256 _fee) 
    VRFConsumerBase(
      _VRFCoordinator,
      _linkToken
    )
  {
    VRFKey = _VRFKey;
    VRFFee = _fee; // 0.0001 LINK (Mumbai values - varies by network)
    _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
  }

  function requestEntropy(address _address, uint256 _tokenId, uint256 _index) external onlyRole(REQUESTER_ROLE) {
    require(!tokenEntropyRequest[_address][_tokenId][_index].requested, "Request already performed");
    Request memory request = Request({
      finished: false,
      requested: true,
      targetAddress: _address,
      tokenId: _tokenId,
      index: _index,
      value: 0
    });
    bytes32 requestId = getRandomNumber();
    entropyRequests[requestId] = request;
    tokenEntropyRequest[_address][_tokenId][_index] = request;
    emit EntropyRequested(request.targetAddress, request.tokenId, request.index, requestId);
  }

  /** 
  * Requests randomness 
  */
  function getRandomNumber() internal returns (bytes32 requestId) {
      require(LINK.balanceOf(address(this)) >= VRFFee, "Not enough LINK - fill contract with faucet");
      return requestRandomness(VRFKey, VRFFee);
  }

  /**
  * Callback function used by VRF Coordinator
  */
  function fulfillRandomness(bytes32 requestId, uint256 randomness) internal override {
    Request memory request = entropyRequests[requestId];
    require(!request.finished, "Requested existent entropy");
    request.value = randomness;
    request.finished = true;
    EntropyStorage(request.targetAddress).setEntropy(request.tokenId, request.index, randomness);
    entropyRequests[requestId] = request;
    emit EntropyReceived(request.targetAddress, request.tokenId, request.index, request.value);
  }
}