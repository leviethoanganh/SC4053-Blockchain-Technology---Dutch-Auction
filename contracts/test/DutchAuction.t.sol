// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {DutchAuction} from "../src/DutchAuction.sol";
import {AuctionToken} from "../src/AuctionToken.sol";

/// @notice A bidder contract with no receive(): it cannot accept ETH refunds.
contract NoEthBidder {
    function bidOn(DutchAuction a) external payable {
        a.bid{value: msg.value}();
    }

    function claimFrom(DutchAuction a) external {
        a.claim();
    }

    function withdrawFrom(DutchAuction a) external {
        a.withdrawProceeds();
    }
}

/// @notice Unit and fuzz tests for DutchAuction. Section numbers refer to spec.md.
contract DutchAuctionTest is Test {
    uint256 constant SUPPLY = 1000e18;
    uint256 constant P0 = 0.001 ether;
    uint256 constant PR = 0.0001 ether;
    uint256 constant DURATION = 20 minutes;

    DutchAuction auction;
    AuctionToken token;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        vm.prank(owner);
        auction = new DutchAuction("Tulip", "TLP", SUPPLY, P0, PR);
        token = auction.token();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    // ----- helpers -----

    function _start() internal {
        vm.prank(owner);
        auction.start();
    }

    function _bid(address who, uint256 amount) internal {
        vm.prank(who);
        auction.bid{value: amount}();
    }

    function _claim(address who) internal returns (uint256 tokens, uint256 refund) {
        uint256 tokBefore = token.balanceOf(who);
        uint256 ethBefore = who.balance;
        vm.prank(who);
        auction.claim();
        tokens = token.balanceOf(who) - tokBefore;
        refund = who.balance - ethBefore;
    }

    // ===== Setup (§2) =====

    function test_DeployMintsWholeSupplyToAuction() public view {
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(auction)), SUPPLY);
        assertEq(token.symbol(), "TLP");
        assertEq(auction.owner(), owner);
    }

    function test_RevertWhen_ConfigInvalid() public {
        vm.expectRevert(DutchAuction.InvalidConfig.selector);
        new DutchAuction("T", "T", 0, P0, PR);
        vm.expectRevert(DutchAuction.InvalidConfig.selector);
        new DutchAuction("T", "T", SUPPLY, PR, PR);
        vm.expectRevert(DutchAuction.InvalidConfig.selector);
        new DutchAuction("T", "T", SUPPLY, P0, 0);
    }

    // ===== Start (S2) =====

    function test_StartSetsTimes() public {
        _start();
        assertEq(auction.startTime(), block.timestamp);
        assertEq(auction.endTime(), block.timestamp + DURATION);
    }

    function test_RevertWhen_NonOwnerStarts() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        auction.start();
    }

    function test_RevertWhen_StartedTwice() public {
        _start();
        vm.expectRevert(DutchAuction.AlreadyStarted.selector);
        vm.prank(owner);
        auction.start();
    }

    // ===== Price (§3.2) =====

    function test_PriceBeforeStartIsStartPrice() public view {
        assertEq(auction.currentPrice(), P0);
    }

    function test_PriceDecaysLinearly() public {
        _start();
        uint256 t0 = block.timestamp;
        assertEq(auction.currentPrice(), P0);
        vm.warp(t0 + 10 minutes);
        assertEq(auction.currentPrice(), (P0 + PR) / 2); // halfway: 0.00055 ETH
        vm.warp(t0 + 15 minutes);
        assertEq(auction.currentPrice(), P0 - (P0 - PR) * 3 / 4);
        vm.warp(t0 + DURATION);
        assertEq(auction.currentPrice(), PR);
        vm.warp(t0 + 3 hours);
        assertEq(auction.currentPrice(), PR);
    }

    function test_PriceNeverIncreases() public {
        _start();
        uint256 t0 = block.timestamp;
        uint256 last = auction.currentPrice();
        for (uint256 s = 1; s <= DURATION + 5; s++) {
            uint256 p = auction.priceAt(t0 + s);
            assertLe(p, last);
            assertGe(p, PR);
            last = p;
        }
    }

    // ===== Bidding rules (S1) =====

    function test_RevertWhen_BidBeforeStart() public {
        vm.expectRevert(DutchAuction.NotStarted.selector);
        _bid(alice, 0.1 ether);
    }

    function test_RevertWhen_BidIsZero() public {
        _start();
        vm.expectRevert(DutchAuction.ZeroBid.selector);
        _bid(alice, 0);
    }

    function test_RevertWhen_BidAtEndTime() public {
        _start();
        vm.warp(auction.endTime());
        vm.expectRevert(DutchAuction.AuctionEnded.selector);
        _bid(alice, 0.01 ether);
    }

    function test_BidOneSecondBeforeEndIsAccepted() public {
        _start();
        vm.warp(auction.endTime() - 1);
        _bid(alice, 0.01 ether);
        assertEq(auction.commitments(alice), 0.01 ether);
    }

    function test_BidRecordsCommitmentAndEmitsPrice() public {
        _start();
        vm.warp(block.timestamp + 10 minutes);
        vm.expectEmit(address(auction));
        emit DutchAuction.BidPlaced(alice, 0.1 ether, (P0 + PR) / 2);
        _bid(alice, 0.1 ether);
        _bid(alice, 0.05 ether);
        assertEq(auction.commitments(alice), 0.15 ether);
        assertEq(auction.totalCommitted(), 0.15 ether);
        assertFalse(auction.isSoldOut());
    }

    function test_RevertWhen_OwnerBids() public {
        _start();
        vm.deal(owner, 1 ether);
        vm.expectRevert(DutchAuction.OwnerCannotBid.selector);
        _bid(owner, 1 ether);
    }

    function test_RevertWhen_PlainEthSent() public {
        (bool ok,) = address(auction).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ===== Case A: a bid crosses the threshold (§3.3, §3.4) =====

    function test_CaseA_ThresholdBidClearsAndIsPartlyRefunded() public {
        _start();
        _bid(alice, 0.3 ether); // at 0.001: supply costs 1 ETH, not enough
        vm.warp(block.timestamp + 10 minutes); // price 0.00055: supply costs 0.55 ETH
        _bid(bob, 0.4 ether); // total 0.7 >= 0.55 -> clears, excess 0.15

        assertTrue(auction.isSoldOut());
        assertEq(auction.clearingPrice(), 0.00055 ether);
        assertEq(auction.thresholdBidder(), bob);
        assertEq(auction.thresholdExcess(), 0.15 ether);

        vm.expectRevert(DutchAuction.SoldOut.selector);
        _bid(carol, 0.01 ether);

        auction.finalize();
        assertEq(token.totalSupply(), SUPPLY); // nothing burned

        (uint256 aTokens, uint256 aRefund) = _claim(alice);
        (uint256 bTokens, uint256 bRefund) = _claim(bob);
        // alice: 0.3 / 0.00055 = 545.45 TLP; bob uses 0.25 -> 454.54 TLP
        assertApproxEqAbs(aTokens, 545.454545454545454545e18, 1);
        assertApproxEqAbs(bTokens, 454.545454545454545454e18, 1);
        assertLe(aTokens + bTokens, SUPPLY);
        assertApproxEqAbs(bRefund, 0.15 ether, 1);
        assertEq(aRefund, 0); // only the threshold bidder is refunded
    }

    function test_EveryonePaysTheSameClearingPrice() public {
        _start();
        _bid(alice, 0.2 ether); // early, at 0.001
        vm.warp(block.timestamp + 12 minutes);
        _bid(bob, 0.5 ether); // later, at a lower price; clears
        auction.finalize();
        uint256 p = auction.clearingPrice();
        (uint256 aTokens, uint256 aRefund) = _claim(alice);
        (uint256 bTokens,) = _claim(bob);
        // alice paid (0.2 - refund) for aTokens: effective price == clearing price
        assertApproxEqAbs((0.2 ether - aRefund) * 1e18 / aTokens, p, 1);
        assertApproxEqAbs(aTokens + bTokens, SUPPLY, 2);
    }

    // ===== Case B: the price falls to meet demand (§3.3) =====

    function test_CaseB_PriceFallsToDemand() public {
        _start();
        uint256 t0 = block.timestamp;
        _bid(alice, 0.3 ether); // demand price = 0.3 ETH / 1000 = 0.0003, reached after ~933 s
        vm.warp(t0 + 930);
        assertFalse(auction.isSoldOut());
        _bid(bob, 0.000001 ether); // still accepted just before
        vm.warp(t0 + 940);
        assertTrue(auction.isSoldOut());
        assertTrue(auction.hasEnded());
        vm.expectRevert(DutchAuction.SoldOut.selector);
        _bid(carol, 0.01 ether);

        auction.finalize(); // allowed before 20 minutes because it sold out
        assertEq(auction.clearingPrice(), auction.demandPrice());
        (uint256 aTokens,) = _claim(alice);
        (uint256 bTokens,) = _claim(bob);
        assertLe(aTokens + bTokens, SUPPLY);
        assertApproxEqRel(aTokens + bTokens, SUPPLY, 1e12); // within 0.0001%
        assertEq(token.totalSupply(), SUPPLY);
    }

    // ===== Case C: time runs out, unsold tokens burned (§3.6) =====

    function test_CaseC_TimeUpBurnsUnsold() public {
        _start();
        _bid(alice, 0.03 ether);
        vm.warp(auction.endTime());
        vm.expectEmit(address(auction));
        emit DutchAuction.AuctionFinalized(PR, 300e18, 700e18);
        auction.finalize();

        assertEq(auction.clearingPrice(), PR);
        assertEq(token.totalSupply(), 300e18);
        (uint256 aTokens, uint256 aRefund) = _claim(alice);
        assertEq(aTokens, 300e18);
        assertEq(aRefund, 0);
        assertEq(token.balanceOf(address(auction)), 0);
    }

    function test_CaseC_NoBidsBurnsEverything() public {
        _start();
        vm.warp(auction.endTime());
        auction.finalize();
        assertEq(token.totalSupply(), 0);
    }

    // ===== Finalize (S2) =====

    function test_RevertWhen_FinalizeBeforeStart() public {
        vm.expectRevert(DutchAuction.NotStarted.selector);
        auction.finalize();
    }

    function test_RevertWhen_FinalizeWhileRunning() public {
        _start();
        _bid(alice, 0.01 ether);
        vm.warp(block.timestamp + 5 minutes);
        vm.expectRevert(DutchAuction.AuctionStillRunning.selector);
        auction.finalize();
    }

    function test_RevertWhen_FinalizedTwice() public {
        _start();
        vm.warp(auction.endTime());
        auction.finalize();
        vm.expectRevert(DutchAuction.AlreadyFinalized.selector);
        auction.finalize();
    }

    // ===== Claims (S2, S4) =====

    function test_RevertWhen_ClaimBeforeFinalize() public {
        _start();
        _bid(alice, 0.01 ether);
        vm.expectRevert(DutchAuction.NotFinalized.selector);
        vm.prank(alice);
        auction.claim();
    }

    function test_RevertWhen_ClaimTwice() public {
        _start();
        _bid(alice, 0.01 ether);
        vm.warp(auction.endTime());
        auction.finalize();
        _claim(alice);
        vm.expectRevert(DutchAuction.NothingToClaim.selector);
        vm.prank(alice);
        auction.claim();
    }

    function test_RevertWhen_ClaimWithoutBid() public {
        _start();
        vm.warp(auction.endTime());
        auction.finalize();
        vm.expectRevert(DutchAuction.NothingToClaim.selector);
        vm.prank(carol);
        auction.claim();
    }

    function test_RevertWhen_RefundCannotBeDelivered() public {
        // A contract that rejects ETH and is owed a refund: claim() reverts as a whole, so it
        // never receives tokens without its refund. Known limitation, documented in the README.
        NoEthBidder nb = new NoEthBidder();
        _start();
        _bid(alice, 0.3 ether);
        vm.warp(block.timestamp + 10 minutes);
        nb.bidOn{value: 0.4 ether}(auction); // sells out, owed a 0.15 ETH refund
        auction.finalize();
        vm.expectRevert(DutchAuction.EthTransferFailed.selector);
        nb.claimFrom(auction);
        assertEq(auction.commitments(address(nb)), 0.4 ether); // nothing was lost; state rolled back
    }

    function test_RevertWhen_OwnerCannotReceiveProceeds() public {
        NoEthBidder nb = new NoEthBidder();
        vm.prank(owner);
        auction.transferOwnership(address(nb));
        vm.prank(address(nb));
        auction.start();
        _bid(alice, 0.03 ether);
        vm.warp(auction.endTime());
        auction.finalize();
        vm.expectRevert(DutchAuction.EthTransferFailed.selector);
        nb.withdrawFrom(auction);
        assertEq(auction.proceeds(), 0.03 ether); // still there to withdraw later
    }

    // ===== Proceeds (§3.7) =====

    function test_OwnerWithdrawsFullProceedsBeforeAnyClaim() public {
        _start();
        _bid(alice, 0.3 ether);
        vm.warp(block.timestamp + 10 minutes);
        _bid(bob, 0.4 ether); // clears at 0.55 ETH, bob's excess 0.15
        auction.finalize();
        assertEq(auction.proceeds(), 0.55 ether);

        // Nobody has claimed, yet the owner gets the whole sale; only bob's refund stays behind.
        uint256 ownerBefore = owner.balance;
        vm.prank(owner);
        auction.withdrawProceeds();
        assertEq(owner.balance - ownerBefore, 0.55 ether);
        assertEq(address(auction).balance, 0.15 ether);

        // Bidders can still claim everything after the owner withdrew.
        (uint256 aTokens, uint256 aRefund) = _claim(alice);
        (uint256 bTokens, uint256 bRefund) = _claim(bob);
        assertEq(aRefund, 0);
        assertEq(bRefund, 0.15 ether);
        assertLe(aTokens + bTokens, SUPPLY);
        assertEq(address(auction).balance, 0);
    }

    function test_UnclaimedBidderDoesNotLockProceeds() public {
        _start();
        _bid(alice, 0.03 ether);
        _bid(bob, 0.02 ether);
        vm.warp(auction.endTime());
        auction.finalize();

        _claim(alice); // bob never claims
        uint256 ownerBefore = owner.balance;
        vm.prank(owner);
        auction.withdrawProceeds();
        assertEq(owner.balance - ownerBefore, 0.05 ether); // bob's payment included
        assertEq(address(auction).balance, 0);
        assertEq(token.balanceOf(address(auction)), 200e18); // bob's tokens wait for him
    }

    function test_RevertWhen_NonOwnerWithdraws() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        auction.withdrawProceeds();
    }

    function test_RevertWhen_NothingToWithdraw() public {
        vm.expectRevert(DutchAuction.NothingToWithdraw.selector);
        vm.prank(owner);
        auction.withdrawProceeds();
    }

    // ===== Fuzz: accounting can never break (S4) =====

    /// @notice Random bids at random times. Whatever happens, tokens handed out never exceed
    ///         what was sold, the owner can be paid before any claim, and the contract
    ///         still holds every refund.
    function testFuzz_AccountingNeverBreaks(uint96[6] memory amounts, uint16[6] memory gaps) public {
        address[6] memory bidders =
            [alice, bob, carol, makeAddr("dave"), makeAddr("erin"), makeAddr("frank")];
        _start();
        uint256 t = block.timestamp;
        uint256[6] memory placed;

        for (uint256 i = 0; i < 6; i++) {
            t += bound(gaps[i], 0, 300);
            vm.warp(t);
            uint256 amount = bound(amounts[i], 1, 0.6 ether);
            vm.deal(bidders[i], amount);
            if (auction.hasEnded()) break;
            _bid(bidders[i], amount);
            placed[i] = amount;
        }

        vm.warp(auction.endTime());
        auction.finalize();
        uint256 sold = token.totalSupply(); // finalize burned the unsold part

        // The owner is paid in full before anyone claims; every claim must still succeed.
        uint256 ownerOut = auction.proceeds();
        assertEq(ownerOut, auction.totalCommitted() - auction.thresholdExcess());
        if (ownerOut != 0) {
            vm.prank(owner);
            auction.withdrawProceeds();
        }

        uint256 tokensOut;
        uint256 ethOut;
        for (uint256 i = 0; i < 6; i++) {
            if (placed[i] == 0) continue;
            (uint256 tk, uint256 rf) = _claim(bidders[i]);
            tokensOut += tk;
            ethOut += rf;
            assertLe(rf, placed[i]); // never refunded more than committed
        }
        assertLe(tokensOut, sold);
        assertEq(ownerOut + ethOut, auction.totalCommitted());
        assertEq(address(auction).balance, 0);
    }
}
