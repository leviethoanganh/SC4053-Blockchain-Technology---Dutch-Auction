// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {DutchAuction} from "../src/DutchAuction.sol";

/// @notice Deploys the DutchAuction (which creates the TLP token).
///
/// Local Anvil:
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
///
/// Sepolia (keep the key out of git; see README):
///   forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $DEPLOYER_KEY
///
/// Set START_AUCTION=true to also start the 20-minute timer right away.
contract Deploy is Script {
    // Must match frontend/src/config.ts
    uint256 constant SUPPLY = 1_000e18; // 1,000 TLP
    uint256 constant START_PRICE = 0.00001 ether; // per TLP
    uint256 constant RESERVE_PRICE = 0.000001 ether; // per TLP

    function run() external returns (DutchAuction auction) {
        bool startNow = vm.envOr("START_AUCTION", false);

        vm.startBroadcast();
        auction = new DutchAuction("Tulip", "TLP", SUPPLY, START_PRICE, RESERVE_PRICE);
        if (startNow) auction.start();
        vm.stopBroadcast();

        console.log("DutchAuction:", address(auction));
        console.log("AuctionToken:", address(auction.token()));
        console.log("Deploy block:", block.number);
        console.log("Started:", startNow);
        console.log("Put the DutchAuction address in frontend/.env.local as VITE_AUCTION_ADDRESS");
    }
}
