// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./TestToken.sol";

/**
 * @dev {ERC20} testToken, freely minteable by everyone
 *
 * This is just so we can test source dependent on an ERC20
 * fo example withdrawERC20 from EntropyManager
 */
contract TestERC20 is TestToken
{
    constructor( string memory name_, string memory symbol_) TestToken(name_, symbol_) {
    }
}
