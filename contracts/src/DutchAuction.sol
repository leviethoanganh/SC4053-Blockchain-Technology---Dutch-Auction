// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AuctionToken} from "./AuctionToken.sol";

/// @title DutchAuction
/// @notice A 20-minute Dutch auction for a fixed supply of AuctionToken (spec.md).
///         The price falls linearly from `startPrice` to `reservePrice`. Bidders commit ETH;
///         everyone pays the same clearing price; unsold tokens are burned; tokens and ETH
///         refunds are pulled by each bidder with `claim()`.
/// @dev Prices are in wei per WHOLE token (1e18 base units). Token amounts are base units.
contract DutchAuction is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    /// @notice The auction lasts exactly 20 minutes from `start()` (spec R3).
    uint256 public constant DURATION = 20 minutes;

    uint256 private constant ONE_TOKEN = 1e18;

    /// @notice The token being sold. Created by this contract, which holds the whole supply.
    AuctionToken public immutable token;
    /// @notice Price at the start, in wei per whole token.
    uint256 public immutable startPrice;
    /// @notice Lowest price, reached at the end, in wei per whole token.
    uint256 public immutable reservePrice;
    /// @notice Tokens for sale, in base units.
    uint256 public immutable totalSupply;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice When `start()` was called. 0 until then.
    uint256 public startTime;
    /// @notice `startTime + DURATION`. 0 until started.
    uint256 public endTime;
    /// @notice The uniform price every bidder pays. 0 until known (spec §3.3).
    uint256 public clearingPrice;
    /// @notice Total ETH committed by all bidders.
    uint256 public totalCommitted;
    /// @notice True once `finalize()` has run.
    bool public finalized;
    /// @notice True once the whole supply is sold (case A at the crossing bid, case B at finalize).
    bool public soldOut;
    /// @notice ETH committed per bidder. Set to 0 when the bidder claims.
    mapping(address bidder => uint256 amount) public commitments;

    /// @notice The bidder whose bid crossed the clearing threshold (spec §3.4), if any.
    address public thresholdBidder;
    /// @notice The part of the threshold bid that was not needed, refunded on claim.
    uint256 public thresholdExcess;
    /// @notice Sale proceeds from claims so far that the owner has not withdrawn yet.
    uint256 public proceeds;

    // ---------------------------------------------------------------------
    // Events and errors
    // ---------------------------------------------------------------------

    event AuctionStarted(uint256 startTime, uint256 endTime);
    event BidPlaced(address indexed bidder, uint256 amount, uint256 price);
    event AuctionFinalized(uint256 clearingPrice, uint256 sold, uint256 burned);
    event Claimed(address indexed bidder, uint256 tokens, uint256 refund);
    event ProceedsWithdrawn(address indexed to, uint256 amount);

    error InvalidConfig();
    error AlreadyStarted();
    error NotStarted();
    error AuctionEnded();
    error SoldOut();
    error ZeroBid();
    error AuctionStillRunning();
    error AlreadyFinalized();
    error NotFinalized();
    error NothingToClaim();
    error NothingToWithdraw();
    error EthTransferFailed();

    // ---------------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------------

    /// @param name_         Token name
    /// @param symbol_       Token symbol
    /// @param supply        Tokens for sale, in base units (e.g. 1000e18)
    /// @param startPrice_   Opening price, wei per whole token
    /// @param reservePrice_ Floor price, wei per whole token (must be > 0 and < startPrice_)
    constructor(string memory name_, string memory symbol_, uint256 supply, uint256 startPrice_, uint256 reservePrice_)
        Ownable(msg.sender)
    {
        if (supply == 0 || reservePrice_ == 0 || startPrice_ <= reservePrice_) revert InvalidConfig();
        startPrice = startPrice_;
        reservePrice = reservePrice_;
        totalSupply = supply;
        token = new AuctionToken(name_, symbol_, supply, address(this));
    }

    /// @notice Opens bidding and starts the 20-minute clock. Owner only, once.
    function start() external onlyOwner {
        if (startTime != 0) revert AlreadyStarted();
        startTime = block.timestamp;
        endTime = block.timestamp + DURATION;
        emit AuctionStarted(startTime, endTime);
    }

    // ---------------------------------------------------------------------
    // Price and state views
    // ---------------------------------------------------------------------

    /// @notice Price at timestamp `t` (spec §3.2). Linear from startPrice to reservePrice.
    function priceAt(uint256 t) public view returns (uint256) {
        if (startTime == 0 || t <= startTime) return startPrice;
        uint256 elapsed = t - startTime;
        if (elapsed >= DURATION) return reservePrice;
        return startPrice - ((startPrice - reservePrice) * elapsed) / DURATION;
    }

    /// @notice Price right now.
    function currentPrice() public view returns (uint256) {
        return priceAt(block.timestamp);
    }

    /// @notice The price at which the ETH committed so far buys exactly the whole supply.
    /// @dev Rounded up so allocations at this price never exceed the supply (spec §3.5).
    function demandPrice() public view returns (uint256) {
        return Math.mulDiv(totalCommitted, ONE_TOKEN, totalSupply, Math.Rounding.Ceil);
    }

    /// @notice True once the supply is sold out, by a bid (case A) or by the falling price (case B).
    function isSoldOut() public view returns (bool) {
        return soldOut || _soldOutByDemand();
    }

    /// @notice True once bidding is over: sold out or 20 minutes passed.
    function hasEnded() public view returns (bool) {
        return startTime != 0 && (block.timestamp >= endTime || isSoldOut());
    }

    // ---------------------------------------------------------------------
    // Bidding
    // ---------------------------------------------------------------------

    /// @notice Commit ETH to buy tokens at the (future) clearing price.
    /// @dev If this bid makes the committed ETH cover the whole supply at the current price,
    ///      the auction clears now at that price (case A) and the unneeded part of this
    ///      bid is recorded for refund (spec §3.4).
    function bid() external payable {
        if (startTime == 0) revert NotStarted();
        if (block.timestamp >= endTime) revert AuctionEnded();
        if (msg.value == 0) revert ZeroBid();
        if (isSoldOut()) revert SoldOut();

        uint256 price = currentPrice();
        commitments[msg.sender] += msg.value;
        totalCommitted += msg.value;
        emit BidPlaced(msg.sender, msg.value, price);

        uint256 cost = _costOfSupply(price);
        if (totalCommitted >= cost) {
            soldOut = true;
            clearingPrice = price;
            thresholdBidder = msg.sender;
            thresholdExcess = totalCommitted - cost;
        }
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /// @notice Fix the clearing price and burn unsold tokens. Anyone can call it, once,
    ///         after the auction has sold out or 20 minutes have passed.
    function finalize() external {
        if (startTime == 0) revert NotStarted();
        if (finalized) revert AlreadyFinalized();

        uint256 sold;
        if (soldOut) {
            // Case A: a bid already crossed the threshold.
            sold = totalSupply;
        } else if (_soldOutByDemand()) {
            // Case B: the price fell to meet demand.
            soldOut = true;
            clearingPrice = demandPrice();
            sold = totalSupply;
        } else {
            // Case C: time ran out before demand covered the supply.
            if (block.timestamp < endTime) revert AuctionStillRunning();
            clearingPrice = reservePrice;
            sold = Math.mulDiv(totalCommitted, ONE_TOKEN, reservePrice);
        }

        finalized = true;
        uint256 burned = totalSupply - sold;
        emit AuctionFinalized(clearingPrice, sold, burned);
        if (burned != 0) token.burn(burned);
    }

    /// @notice Receive your tokens and any ETH refund. Each bidder once, after `finalize()`.
    /// @dev Pull payment with checks-effects-interactions and a reentrancy guard (spec S3).
    ///      Tokens round down and cost rounds up, so the contract never owes more than it holds.
    function claim() external nonReentrant {
        if (!finalized) revert NotFinalized();
        uint256 committed = commitments[msg.sender];
        if (committed == 0) revert NothingToClaim();

        // Effects
        commitments[msg.sender] = 0;
        uint256 usable = msg.sender == thresholdBidder ? committed - thresholdExcess : committed;
        uint256 tokens = Math.mulDiv(usable, ONE_TOKEN, clearingPrice);
        uint256 cost = Math.mulDiv(tokens, clearingPrice, ONE_TOKEN, Math.Rounding.Ceil);
        uint256 refund = committed - cost;
        proceeds += cost;
        emit Claimed(msg.sender, tokens, refund);

        // Interactions
        if (tokens != 0) IERC20(address(token)).safeTransfer(msg.sender, tokens);
        if (refund != 0) {
            (bool ok,) = payable(msg.sender).call{value: refund}("");
            if (!ok) revert EthTransferFailed();
        }
    }

    /// @notice Owner withdraws the sale proceeds collected from claims so far.
    /// @dev Only claimed costs are withdrawable, so bidders' refunds can never be taken (spec §3.7).
    function withdrawProceeds() external onlyOwner nonReentrant {
        uint256 amount = proceeds;
        if (amount == 0) revert NothingToWithdraw();
        proceeds = 0;
        emit ProceedsWithdrawn(msg.sender, amount);
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev ETH needed to buy the whole supply at `price`.
    function _costOfSupply(uint256 price) private view returns (uint256) {
        return Math.mulDiv(price, totalSupply, ONE_TOKEN);
    }

    /// @dev Case B: the falling price has reached the price at which current demand buys everything.
    function _soldOutByDemand() private view returns (bool) {
        if (startTime == 0 || totalCommitted == 0) return false;
        uint256 d = demandPrice();
        return d >= reservePrice && currentPrice() <= d;
    }
}
