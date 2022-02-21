// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/**
 * @dev {ERC721} testToken, freely minteable by everyone
 *
 * This is just so we can test source dependent on an ERC721
 * fo example withdrawERC721 from EntropyManager
 */
contract TestERC721 is ERC721Enumerable
{
    constructor(string memory _description, string memory _name) ERC721(_description, _name) {
    }

    function mint(address to, uint256 _tokenId) public virtual {
        _mint(to, _tokenId);
    }
}
