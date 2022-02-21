pragma solidity ^0.8.9;
// SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @dev Simple class to store the entropy we fetch
 * from the IEntropyManager, although perhaps more
 * sources could come from the future.
 *
 * We are splitting this into a separate SC because incoming
 * ERC721 will share exactly the same logic so it makes sense
 * to share it.
 */
contract EntropyStorage is AccessControl {

  ///@dev So only the EntropyManager can set the entropy
  bytes32 public constant SET_ENTROPY_ROLE = keccak256("SET_ENTROPY_ROLE");

  struct Entropy {
    ///@dev Just in the improbable case that the entropy is just 0
    bool    finished;
    uint256 value;
  }

  constructor() {
    _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  ///@dev Mapping from tokenId to index to actual entropy value
  ///@dev Entropy in polygon is cheap so we want the possibility of having more
  mapping(uint256 => mapping(uint256 => Entropy)) public entropyStorage;

  ///Default values will be false
  function hasEntropy(uint256 _tokenId, uint256 _index) public view returns (bool) {
    return entropyStorage[_tokenId][_index].finished;
  }
  
  function getEntropy(uint256 _tokenId, uint256 _index) public view returns (uint256) {
    Entropy memory entropy = entropyStorage[_tokenId][_index];
    require(entropy.finished, "Queried non-existent entropy");
    return entropy.value;
  }

  function setEntropy(uint256 _tokenId, uint256 _index, uint256 _randomness) external onlyRole(SET_ENTROPY_ROLE) {
    Entropy memory entropy = entropyStorage[_tokenId][_index];
    ///@notice Once set, entropy can't be changed
    require(!entropy.finished, "Setting existent entropy");
    entropy.value = _randomness;
    entropy.finished = true;
    entropyStorage[_tokenId][_index] = entropy;
  }

}