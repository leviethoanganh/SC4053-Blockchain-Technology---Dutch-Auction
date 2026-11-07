# Dutch Auction dApp: Specification

> **Status:** v1, 31 Oct 2026. Requirements are quoted from the SC4053 project brief (Option 2). Design decisions were agreed by the team at kickoff and in the frontend work, and this file was drafted with Claude from those inputs. **The team must review and sign off below.** The same file is given to AI tools as the spec for generating and reviewing the contracts (report Section 3).

## 1. Requirements from the brief

| ID | Requirement (brief wording) |
| --- | --- |
| R1 | **ERC20 Integration:** Define project tokens using the ERC20 standard. |
| R2 | **Auction Engine:** Implement Dutch auction mechanics in separate smart contract(s). |
| R3 | **Time-Bound Elapse:** The auction runs for exactly 20 minutes. Tokens sell out at/above reserve price, or unsold tokens are burned. |
| R4 | **Token Claims & Refunds:** Distribute minted tokens and automatically process ETH refunds for surplus bid amounts. |
| R5 | **Descending price:** Bidding opens at a high starting price and descends automatically over time based on a predefined decay function. |
| R6 | **Uniform clearing price:** Participants commit ETH. When total committed capital meets total token supply, the auction clears. Every winning bidder pays the same clearing price. Excess ETH is refunded. |
| R7 | **(Bonus)** Demonstrate reentrancy attack resistance. |
| R8 | A front-end web app for the token launch (MetaMask). |

The brief's "tricky points", and our answers, are in §4.

## 2. Parameters

| Parameter | Value | Note |
| --- | --- | --- |
| Token | Tulip (TLP), 18 decimals | `AuctionToken`, OpenZeppelin `ERC20` + `ERC20Burnable` |
| Total supply `S` | 1,000 TLP (`1000e18`) | All minted to the auction contract at deploy |
| Start price `P0` | 0.00001 ETH per TLP | wei per whole token (1e18 units) |
| Reserve price `Pr` | 0.000001 ETH per TLP | Price never goes below this |
| Duration `D` | 20 minutes (1,200 s) | Exactly, measured with `block.timestamp` |

Prices are set in the constructor so tests can use other values. The frontend's `src/config.ts` must match the deployed values.

## 3. Auction rules

### 3.1 Lifecycle
1. **Deployed:** the auction creates the token and holds the whole supply. No bids yet.
2. **Live:** the owner calls `start()`. `startTime = block.timestamp`, `endTime = startTime + 20 min`.
3. **Ended:** either the supply is sold out (§3.3) or `block.timestamp >= endTime`.
4. **Finalized:** anyone calls `finalize()` once. It fixes the clearing price and burns unsold tokens.
5. **Claims:** each bidder calls `claim()` once to receive tokens plus any ETH refund. The owner can withdraw sale proceeds.

### 3.2 Price (R5)
Linear decay, recalculated every second from block time:

```
price(t) = P0 - (P0 - Pr) * (t - startTime) / D     for startTime <= t < endTime
price(t) = Pr                                       for t >= endTime
```
Integer division rounds down, so the price drops in whole-wei steps.

### 3.3 When the auction clears (R6)
Let `C` be the total ETH committed. The supply costs `price × S / 1e18` ETH. The auction clears at the **first moment** this is true:

```
C >= price(t) × S / 1e18
```
This can happen in two ways:

| Case | What happens | Clearing price |
| --- | --- | --- |
| **A. A bid crosses the line** | The bid that makes `C` reach the cost at the current price | `price(t)` at that bid |
| **B. The price falls to meet demand** | No bid needed. The price drops until `C` buys everything | `ceil(C × 1e18 / S)`, the demand price |
| **C. Time runs out first** | `C` never covers the supply, even at `Pr` | `Pr` |

After A or B, new bids are rejected. Case B is detected by `bid()` (rejects bids) and settled by `finalize()`.

### 3.4 The threshold bid (brief: "a bid bridges across the clearing threshold")
In case A only part of the last bid is needed. That bidder's excess is
`excess = C − price × S / 1e18`, and it is refunded at claim time. Earlier bids by the same address are used in full.

### 3.5 Allocation and refunds (R4, R6)
For each bidder with total commitment `c`:

```
usable = c − (excess if this is the threshold bidder, else 0)
tokens = floor(usable × 1e18 / clearingPrice)
cost   = ceil(tokens × clearingPrice / 1e18)
refund = c − cost
```

**Rounding rule:** tokens round **down** and cost rounds **up**, so the contract can never promise more tokens or ETH than it holds. Dust from rounding stays in the contract.

### 3.6 Unsold tokens (R3)
- Case A or B: the whole supply is sold, so nothing is burned.
- Case C: `sold = floor(C × 1e18 / Pr)`, and `S − sold` is **burned** in `finalize()`, reducing `totalSupply()`.

### 3.7 Proceeds
Each claim adds that bidder's `cost` to `proceeds`. The owner withdraws `proceeds` with `withdrawProceeds()`. Bidders' refunds are never available to the owner.

## 4. Brief's tricky points: our answers

| Tricky point | Answer |
| --- | --- |
| Block-based time countdown and continuous price decay | Price is a pure function of `block.timestamp` (§3.2). No keeper or per-block update is needed. |
| Claims when a bid bridges the threshold | Partial fill plus refund of the excess (§3.4). |
| ETH refunds safe against reentrancy | Pull payments: each bidder calls `claim()`, with no loops over bidders. Checks-effects-interactions (commitment zeroed before sending), plus OpenZeppelin `ReentrancyGuard`. |
| Burning unsold tokens permanently | `ERC20Burnable.burn()` in `finalize()`, which lowers `totalSupply()`. |

## 5. Contract interface

```solidity
// AuctionToken: ERC20 + ERC20Burnable. Whole supply minted to the auction.

// DutchAuction: Ownable + ReentrancyGuard
function start() external;                    // owner only, once
function bid() external payable;              // while live and not sold out
function currentPrice() external view returns (uint256);
function finalize() external;                 // anyone, once, after the auction ended
function claim() external;                    // each bidder once, after finalize
function withdrawProceeds() external;         // owner only

// public state
token, startPrice, reservePrice, totalSupply, startTime, endTime,
clearingPrice, totalCommitted, finalized, commitments(address), proceeds

event BidPlaced(address indexed bidder, uint256 amount, uint256 price);
event AuctionFinalized(uint256 clearingPrice, uint256 sold, uint256 burned);
event Claimed(address indexed bidder, uint256 tokens, uint256 refund);
event ProceedsWithdrawn(address indexed to, uint256 amount);
```
`clearingPrice()` is 0 until known. A bid that sells out sets it at once (case A); otherwise `finalize()` sets it.

## 6. Security requirements

| ID | Requirement |
| --- | --- |
| S1 | Bids are rejected before `start()`, at or after `endTime`, after sell-out, and with 0 ETH. |
| S2 | `start()` can be called only by the owner, and only once. `finalize()` runs once. Each bidder claims once. |
| S3 | `claim()` and `withdrawProceeds()` cannot be re-entered (R7). |
| S4 | Tokens handed out never exceed the supply. ETH paid out never exceeds ETH held. |
| S5 | No loops over bidders, so gas does not grow with the number of bidders. |
| S6 | Plain ETH transfers to the auction (without `bid()`) are rejected. |

## 7. Test plan (Foundry)

Every rule above has a test: price at 0, 10 and 20 minutes and after; each rejection in S1; cases A, B and C; the threshold refund; same-price fairness; burning; claim once; finalize once; owner-only actions; a fuzz test of S4 with random bids and timings; and a malicious contract that re-enters `claim()` (R7).

## 8. Out of scope
Whitelists or KYC, bid cancellation, multiple auctions per contract, and upgradeable contracts.

## Sign-off
- [ ] Member A: ________ (date)
- [ ] Member B: ________ (date)
- [ ] Member C: ________ (date)
