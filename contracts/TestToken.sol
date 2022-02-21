// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";

/**
 * @dev {ERC20} testToken, freely minteable by everyone
 *
 */
contract TestToken is ERC20, ERC20Pausable, ERC20Burnable {
    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
    }

    function mint(address to, uint256 amount) public virtual {
        _mint(to, amount);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Pausable) {
        super._beforeTokenTransfer(from, to, amount);
    }

    ///@dev To be compatible with Chainlink LINK
    function transferAndCall(
        address,
        uint256,
        bytes calldata
    ) public pure returns (bool success) {
        return true;
    }
}
