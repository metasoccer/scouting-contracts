// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "./IEntropyManager.sol";
import "./MetaSoccerPlayers.sol";

/**
 * @dev MetaSoccerScouting implementation
 *
 * MetaSoccer Players are minted from Scouts scoutings.
 * A Scouting implies locking a Scout NFT for a given time (similar to staking),
 * as well as paying a fee in various tokens depending on scouting level (initially MSU and MSC).
 * After the scoutingPeriod, scouting can be finished and Scout goes back to his original owner.
 * When a scouting is finished, the scouting random seed is requested to Chanlink's VRF.
 * Users should be able to mintPlayers once per Scouting, and mint a number of players depending on the scouting level.
 * The scouting VRF seed is expanded as many times as need so the players are minted with all the required seeds.
 * EntropyStorage and EntropyManager are used to store the scoutings seeds.
 * The scouting id is used as the token id for EntropyStorage.
 *
 */
contract MetaSoccerScouting is Context, Pausable, AccessControl, IERC721Receiver, ERC721Enumerable, ReentrancyGuard, EntropyStorage, EIP712
{
    using SafeERC20 for IERC20;

    uint8 public constant requiredPlayerSeeds = 2;

    bytes32 public constant SIGN_ATTRIBUTES_ROLE = keccak256("SIGN_ATTRIBUTES_ROLE");

    address public immutable scouts;
    address public beneficiary;
    address public entropyManager;

    mapping(address => mapping(uint8 => uint256)) public priceByLevel;
    mapping(uint8 => uint8) public playersPerLevel;
    mapping(uint256 => uint256[]) public scoutingsByScout;
    mapping(address => uint256[]) public scoutingsByOwner;

    Scouting[] public scoutings;

    MetaSoccerPlayers public immutable players;

    event ScoutingStarted(address indexed owner, uint256 indexed scoutId, uint256 scoutingId, Scouting scouting);
    event ScoutingCancelled(address indexed owner, uint256 indexed scoutId, uint256 scoutingId, Scouting scouting);
    event ScoutingFinished(address indexed owner, uint256 indexed scoutId, uint256 scoutingId, Scouting scouting);
    event ScoutingClaimed(address indexed owner, uint256 indexed scoutId, uint256 scoutingId, Scouting scouting);

    struct Scouting {
        bool finished;
        bool claimed;
        uint8 level;
        string role;
        address owner;
        uint256 timestamp;
        uint256 scoutId;
        uint256[] playerIds;
        uint256 scoutingPeriod; // Time in seconds
    }

    address[] public paymentTokens;

    constructor(
        address _scouts,
        MetaSoccerPlayers _players,
        address _entropyManager,
        string memory _nftName,
        string memory _nftSymbol
    ) ERC721(_nftName, _nftSymbol) EIP712("MetaSoccer", "1") {
        require(_scouts != address(0), "Wrong Scouts address");
        scouts = _scouts;
        players = _players;
        entropyManager = _entropyManager;
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    /**
     * @dev Blocked transfers, this NFT is used only to keep track of scout original owners.
     */
    function transferFrom(
        address,
        address,
        uint256
    ) public override {
        revert("Transferring Staked NFT");
    }

    function safeTransferFrom(
        address,
        address,
        uint256,
        bytes memory
    ) public override {
        revert("Transferring Staked NFT");
    }

    /**
     * @dev NFTs shoudn't be sent directly to this contract, only the expected Scouts NFT via the sendToScouting method.
     * The operator should then always be this contract.
     */
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata
    ) external whenNotPaused returns (bytes4) {
        require(operator == address(this), "Unable to receive NFT");
        return this.onERC721Received.selector;
    }

    /**
     * @dev Scout NFT attributes will evolve off-chain, but scouting level will depend on them. 
     * The decided approach to solve this issue is that the backend will "authorize" the scouting
     * by signing an EIP712 compliant message including the Scout ID, level and role.
     * The signer account requires the SIGN_ATTRIBUTES_ROLE role.
     */
    function sendToScouting(uint256 _scoutId, uint8 _level, string calldata _role, uint256 _scoutingPeriod, uint256 _expirationTimestamp, bytes calldata _signature) external nonReentrant whenNotPaused {
        address owner = ERC721(scouts).ownerOf(_scoutId);
        require(_msgSender() == owner, "Not Scout Owner");
        _verifyScoutingRequestSignature(_scoutId, _level, _role, _scoutingPeriod, _expirationTimestamp, _signature);

        uint256 paymentTokensLength = paymentTokens.length;
        for (uint256 i = 0; i < paymentTokensLength; i++) {
            uint256 price = priceByLevel[paymentTokens[i]][_level];
            if (price > 0) {
                IERC20(paymentTokens[i]).safeTransferFrom(owner, beneficiary, price);
            }
        }

        _startScouting(_scoutId, _level, _role, _scoutingPeriod, owner);
    }

    /**
     * @dev A scouting scouts can be "forceWithdraw" anytime but scouting fee will be lost.
     */
    function forceWithdraw(uint256 _tokenId) external nonReentrant {
        address owner = ownerOf(_tokenId);
        require(_msgSender() == owner, "Not Token Owner");

        uint256 lastScoutingId = getLastScoutingIdByScoutId(_tokenId);

        _withdraw(owner, lastScoutingId, false);
    }

    /**
     * @dev "finishScouting" returns the Scout to his original owner.
     * VRF seed is requested to enable further minting of players.
     */
    function finishScouting(uint256 _tokenId) external nonReentrant  {
        require(isScoutingTime(_tokenId), "Scouting in progress");
        address owner = ownerOf(_tokenId);

        uint256 lastScoutingId = getLastScoutingIdByScoutId(_tokenId);
        IEntropyManager(entropyManager).requestEntropy(address(this), lastScoutingId, 0);

        _withdraw(owner, lastScoutingId, true);
    }

    /**
     * @dev When scouting is finished, the user who initiated the scouting can "mintPlayers".
     * The VRF seed is required so it can be expanded as needed for all the players to mint.
     * Number of players will depend on scouting level, and each of them requires "requiredPlayerSeeds" seeds.
     * Seed is expanded via _expand internal method as recommended by VRF best practices.
     */
    function mintPlayers(uint256 _scoutingId) external nonReentrant whenNotPaused {
        Scouting storage scouting = scoutings[_scoutingId];
        require(!scouting.claimed, "Already claimed");
        address owner = scouting.owner;
        require(_msgSender() == owner, "Not Scouting Owner");

        uint256 scoutingSeed = getScoutingSeed(_scoutingId, 0);
        uint8 playersToMint = playersPerLevel[scouting.level];

        uint256 numberOfSeedsToGenerate = (playersToMint * requiredPlayerSeeds);
        uint256[] memory seeds = _expand(scoutingSeed, numberOfSeedsToGenerate);
        scouting.claimed = true;
        uint256[] memory playerIds = new uint256[](playersToMint);
        for (uint8 i = 0; i < playersToMint; i++) {
            uint256 playerId = players.mintPlayer(owner, 0, _scoutingId);
            playerIds[i] = playerId;

            for(uint8 j = 0; j < requiredPlayerSeeds; j++) {
                players.setEntropy(playerId, j, seeds[(i * requiredPlayerSeeds) + j]);
            }

        }

        scouting.playerIds = playerIds;
        emit ScoutingClaimed(owner, scouting.scoutId, _scoutingId, scouting);
    }

    // View functions

    function supportsInterface(bytes4 _interfaceId) public view virtual override(ERC721Enumerable, AccessControl) returns (bool) {
        return super.supportsInterface(_interfaceId);
    }

    function isScoutingTime(uint256 _tokenId) public view returns(bool) {
        Scouting memory scouting = scoutings[getLastScoutingIdByScoutId(_tokenId)];
        return scouting.timestamp != 0 && scouting.timestamp + scouting.scoutingPeriod < block.timestamp;
    }

    function isScoutingForAddress(address _address, uint256 _tokenId) public view returns (bool) {
        return ownerOf(_tokenId) == _address && IERC721(scouts).ownerOf(_tokenId) == address(this);
    }

    function getScoutingPlayerIds(uint256 _scoutingId) public view returns (uint256[] memory) {
        return scoutings[_scoutingId].playerIds;
    }

    function getScoutingsLength() public view returns (uint256) {
        return scoutings.length;
    }

    function getScoutingsByOwnerLength(address _owner) public view returns (uint256) {
        return scoutingsByOwner[_owner].length;
    }

    function getScoutingsByScoutIdLength(uint256 _scoutId) public view returns (uint256) {
        return scoutingsByScout[_scoutId].length;
    }

    function getScoutingSeed(uint256 _scoutingId, uint256 _index) public view returns (uint256) {
        return getEntropy(_scoutingId, _index);
    }

    function getLastScoutingIdByScoutId(uint256 _scoutId) public view returns (uint256) {
        return scoutingsByScout[_scoutId][scoutingsByScout[_scoutId].length - 1];
    }

    /**
     * @dev Helpful view function to easily get in a single call all currently scouting scouts for a given address.
     */
    function getOwnedTokenIds(address _owner) external view returns (uint256[] memory) {
        uint256[] memory ret = new uint256[](balanceOf(_owner));
        for (uint256 i = 0; i < balanceOf(_owner); i++) {
            ret[i] = tokenOfOwnerByIndex(_owner, i);
        }
        return ret;
    }

    /**
     * @dev Helpful view function to easily get in a single call all scouting IDs for a given address.
     */
    function getScoutingIdsByAddress(address _owner) external view returns (uint256[] memory) {
        uint256[] memory ret = new uint256[](scoutingsByOwner[_owner].length);
        for (uint256 i = 0; i < scoutingsByOwner[_owner].length; i++) {
            ret[i] = scoutingsByOwner[_owner][i];
        }
        return ret;
    }

    /**
     * @dev Helpful view function to easily get in a single call all scouting IDs for a given scout.
     */
    function getScoutingIdsByScoutId(uint256 _scoutId) external view returns (uint256[] memory) {
        uint256[] memory ret = new uint256[](scoutingsByScout[_scoutId].length);
        for (uint256 i = 0; i < scoutingsByScout[_scoutId].length; i++) {
            ret[i] = scoutingsByScout[_scoutId][i];
        }
        return ret;
    }

    // Admin functions
    
    function setBeneficiary(address _beneficiary) external onlyRole(DEFAULT_ADMIN_ROLE) {
        beneficiary = _beneficiary;
    }

    function setPrice(address _token, uint8 _level, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        priceByLevel[_token][_level] = _amount;
    }

    function setPaymentTokens(address[] calldata _tokens) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paymentTokens = _tokens;
    }

    function setPlayersPerLevel(uint8 _level, uint8 _nPlayers ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        playersPerLevel[_level] = _nPlayers;
    }

    function setEntropyManager(address _entropyManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_entropyManager != address(0), "Invalid Address");
        entropyManager = _entropyManager;
    }

    ///@dev Withdraw function to avoid locking tokens in the contract
    function withdrawERC20(address _address, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(_address).transfer(msg.sender, _amount);
    }

    ///@dev Emergency method to withdraw NFT in case someone sends them via transferFrom
    function withdrawNFT(address _token, uint256 _tokenId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_token != address(this), "Withdrawing scouting NFTs not allowed");
        if (_token == scouts) {
            require(!_exists(_tokenId) || ownerOf(_tokenId) == address(this), "Token can be withdrawn by owner");
        }

        IERC721(_token).safeTransferFrom(address(this), msg.sender, _tokenId);
    }

    function setPause(bool pause) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (pause) {
            _pause();
        } else {
            _unpause();
        }
    }

    // Internal functions

    function _startScouting(uint256 _scoutId, uint8 _level, string calldata _role, uint256 _scoutingPeriod, address _owner) internal {
        ERC721(scouts).safeTransferFrom(_owner, address(this), _scoutId);
        if (_exists(_scoutId)) {
            _transfer(address(this), _owner, _scoutId);
        } else {
           _mint(_owner, _scoutId);
        }

        uint256[] memory playerIds = new uint256[](0);
        Scouting memory scouting = Scouting({
            finished: false,
            claimed: false,
            level: _level,
            role: _role,
            owner: _owner,
            timestamp: block.timestamp,
            scoutId: _scoutId,
            playerIds: playerIds,
            scoutingPeriod: _scoutingPeriod
        });
        uint256 scoutingId = scoutings.length;

        scoutings.push(scouting);
        scoutingsByOwner[_owner].push(scoutingId);
        scoutingsByScout[_scoutId].push(scoutingId);

        emit ScoutingStarted(_owner, _scoutId, scoutingId, scouting);
    }

    function _withdraw(address _owner, uint256 _scoutingId, bool finished) internal {
        Scouting storage scouting = scoutings[_scoutingId];
        scouting.timestamp = 0;

        if (finished) {
            scouting.finished = true;
            emit ScoutingFinished(_owner, scouting.scoutId, _scoutingId, scouting);
        } else {
            emit ScoutingCancelled(_owner, scouting.scoutId, _scoutingId, scouting);
        }

        _transfer(_owner, address(this), scouting.scoutId);
        IERC721(scouts).safeTransferFrom(address(this), _owner, scouting.scoutId);
    }

    /**
     * @dev Since scout level evolves off-chain, "_verifyScoutingRequestSignature" makes sure the requested scouting is allowed.
     * The backend that holds latest scout attributes will sign an EIP712 message with an account having the SIGN_ATTRIBUTES_ROLE.
     * The message includes the scoutId, the scouting level and the scouting role that'll be used as an starting point for the resulting players attributes.
     * A UNIX timestamp in seconds has also been added as a signature expiration.
     */
    function _verifyScoutingRequestSignature(uint256 _scoutId, uint8 _level, string calldata _role, uint256 _scoutingPeriod, uint256 _expirationTimestamp, bytes calldata _signature) internal {
        require(_expirationTimestamp > block.timestamp, "Signature expired");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            keccak256("ScoutingRequest(uint256 scoutId,uint8 level,string role,uint256 scoutingPeriod,uint256 expirationTimestamp)"),
            _scoutId,
            _level,
            keccak256(bytes(_role)),
            _scoutingPeriod,
            _expirationTimestamp
        )));
        address signer = ECDSA.recover(digest, _signature);
        require(hasRole(SIGN_ATTRIBUTES_ROLE, signer), "Invalid signer");
    }

    /**
     * @dev Seed expansion function as recommended by VRF V1 best practices: https://docs.chain.link/docs/chainlink-vrf-best-practices/v1/
     */
    function _expand(uint256 randomValue, uint256 n) internal pure returns (uint256[] memory expandedValues) {
        expandedValues = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            expandedValues[i] = uint256(keccak256(abi.encode(randomValue, i)));
        }
        return expandedValues;
    }
}