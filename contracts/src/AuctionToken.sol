// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @title AuctionToken (Tulip, TLP)
/// @notice The ERC20 token sold in the Dutch auction (spec R1).
/// @dev The whole fixed supply is minted once, at deploy, to `holder` (the auction).
///      There is no owner and no way to mint more. Anyone can burn their own tokens,
///      which is how the auction burns unsold supply (spec §3.6).
contract AuctionToken is ERC20, ERC20Burnable {
    /// @param name_   Token name, e.g. "Tulip"
    /// @param symbol_ Token symbol, e.g. "TLP"
    /// @param supply  Total supply in base units (18 decimals)
    /// @param holder  Address that receives the whole supply
    constructor(string memory name_, string memory symbol_, uint256 supply, address holder) ERC20(name_, symbol_) {
        _mint(holder, supply);
    }
}
