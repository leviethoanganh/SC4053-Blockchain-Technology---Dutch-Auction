// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DutchAuction} from "../src/DutchAuction.sol";

/// @notice A malicious bidder: when the auction sends it a refund, it immediately calls
///         claim() again, trying to be paid twice before its commitment is cleared.
contract ReentrantBidder {
    DutchAuction public immutable auction;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;

    constructor(DutchAuction auction_) {
        auction = auction_;
    }

    function placeBid() external payable {
        auction.bid{value: msg.value}();
    }

    function attack() external {
        auction.claim();
    }

    receive() external payable {
        if (reentryAttempts == 0) {
            reentryAttempts++;
            try auction.claim() {
                reentrySucceeded = true;
            } catch {}
        }
    }
}

/// @notice Spec R7 / S3: claim() cannot be re-entered to drain ETH.
contract ReentrancyTest is Test {
    DutchAuction auction;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");

    function setUp() public {
        vm.prank(owner);
        auction = new DutchAuction("Tulip", "TLP", 1000e18, 0.001 ether, 0.0001 ether);
        vm.prank(owner);
        auction.start();
        vm.deal(alice, 10 ether);
    }

    function test_ReentrantClaimCannotDoubleRefund() public {
        ReentrantBidder attacker = new ReentrantBidder(auction);

        // Alice commits a lot early. The attacker places the bid that sells out, so it is owed
        // a refund, and the contract holds MORE than twice that refund: if re-entry worked,
        // the second payout would succeed. Only the contract's protection can stop it.
        vm.prank(alice);
        auction.bid{value: 0.5 ether}(); // supply costs 1 ETH at the start price
        vm.warp(block.timestamp + 10 minutes); // supply now costs 0.55 ETH
        attacker.placeBid{value: 0.2 ether}(); // total 0.7 >= 0.55; attacker uses 0.05, excess 0.15
        auction.finalize();
        assertGt(address(auction).balance, 2 * 0.15 ether);

        uint256 auctionBefore = address(auction).balance;
        attacker.attack();

        // The re-entry was attempted and blocked; the attacker got exactly one refund.
        assertEq(attacker.reentryAttempts(), 1);
        assertFalse(attacker.reentrySucceeded());
        assertApproxEqAbs(address(attacker).balance, 0.15 ether, 1);
        assertApproxEqAbs(auctionBefore - address(auction).balance, 0.15 ether, 1);

        // Alice's money is untouched: she can still claim in full.
        vm.prank(alice);
        auction.claim();
        assertGt(auction.token().balanceOf(alice), 0);
        assertLe(auction.token().balanceOf(alice) + auction.token().balanceOf(address(attacker)), 1000e18);
    }
}
