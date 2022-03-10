pragma solidity ^0.8.9;
// SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./EntropyStorage.sol";
import "./IPlayersIdGenerator.sol";
import "./TokenWithdraw.sol";

/**
 * @dev MetaSoccerPlayers implementation
 *
 * MetaSoccer Players are minted from Scouts scoutings.
 * Other ways to mint player may be added later as additional "tokenGenerators".
 * EntropyStorage is used to store the attributes seeds.
 * Ownable is used just so we can have access to OpenSea collection editor,
 * AccessControl (via TokenWithdraw) is used for actual permissioning.
 *
 */
contract MetaSoccerPlayers is ERC721Enumerable, EntropyStorage, TokenWithdraw, ReentrancyGuard, Ownable {
  using Strings for uint256;

  bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
  bytes32 public constant SET_DNA_ROLE = keccak256("SET_DNA_ROLE");
  bytes32 public constant SET_ATTRIBUTES_ROLE = keccak256("SET_ATTRIBUTES_ROLE");
  
  mapping(uint256 => string) public tokenDNA;
  mapping(uint256 => mapping(string => string)) public tokenAttributes; 

  mapping(uint256 => uint256[2]) public tokenGenerator;

  IPlayersIdGenerator public idGenerator;

  string private metadata_uri = "https://api.metasoccer.com/players/collection/meta";

  constructor(string memory _description, string memory _name, address _playerIdGenerator) ERC721(_description, _name) {
    idGenerator = IPlayersIdGenerator(_playerIdGenerator);
  }

  // Minting should be called by external contract/account with minter role
  function mintPlayer(address _owner, uint256 _minterType, uint256 _minterId) external onlyRole(MINTER_ROLE) nonReentrant returns (uint256) {
    require(_owner != address(0), "Invalid owner address");

    uint256 _tokenId = idGenerator.getPlayerId(_minterType, _minterId, totalSupply());
    require(!_exists(_tokenId), "Player exists with generated ID");

    tokenGenerator[_tokenId][0] = _minterType;
    tokenGenerator[_tokenId][1] = _minterId;

    _safeMint(_owner, _tokenId);
    return _tokenId;
  }

  // View functions

  function supportsInterface(bytes4 _interfaceId) public view virtual override(ERC721Enumerable, AccessControl) returns (bool) {
    return super.supportsInterface(_interfaceId);
  }

  function tokenURI(uint256 _tokenId) public view virtual override returns (string memory) {
    return string(abi.encodePacked(metadata_uri, "/", _tokenId.toString()));
  }

  function contractURI() public view returns (string memory) {
    return metadata_uri;
  }

  function burnToken(uint256 _tokenId) external {
    require(_isApprovedOrOwner(msg.sender, _tokenId), "Sender is not owner nor approved");
    _burn(_tokenId);
  }

  function getTokenOrigin(uint256 _tokenId) external view returns(uint256[2] memory) {
    return tokenGenerator[_tokenId];
  }

  function exists(uint256 _tokenId) external view returns(bool) {
    return _exists(_tokenId);
  }

  function getOwnedTokenIds(address owner) external view returns (uint256[] memory) {
    uint256 balance = balanceOf(owner);
    uint256[] memory ret = new uint256[](balance);
    for (uint256 i = 0; i < balance; i++) {
        ret[i] = tokenOfOwnerByIndex(owner, i);
    }
    return ret;
  }

  // Admin functions

  function setDNA(uint256 _tokenId, string memory _dna) external onlyRole(SET_DNA_ROLE) {
    require(bytes(tokenDNA[_tokenId]).length == 0, "DNA already exists");
    tokenDNA[_tokenId] = _dna;
  }

  function setAttribute(uint256 _tokenId, string memory _attribute, string memory _value) external onlyRole(SET_ATTRIBUTES_ROLE) {
    tokenAttributes[_tokenId][_attribute] = _value;
  }

  function setMetadataURI(string memory _new_uri) external onlyRole(DEFAULT_ADMIN_ROLE) {
    metadata_uri = _new_uri;
  }

  function setIdGenerator(address _newIdGenerator) external onlyRole(DEFAULT_ADMIN_ROLE) {
    require(_newIdGenerator != address(0), "Invalid address");
    idGenerator = IPlayersIdGenerator(_newIdGenerator);
  }
}