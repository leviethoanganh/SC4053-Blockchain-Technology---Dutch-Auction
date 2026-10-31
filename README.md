# SC4053 Blockchain Technology – Dutch Auction

A token launch on Ethereum using a **Dutch auction**: the price of a new ERC20 token starts high and falls every second for 20 minutes. Bidders commit ETH, and everyone pays the same final price.

This is our group project for SC4053 (Option 2: Dutch Auction dApp).

## How the auction works

1. We create a fixed supply of a new ERC20 token (working name **Tulip, TLP**). The whole supply sits in the auction contract.
2. When the auction starts, the price falls in a straight line from the **start price** to the **reserve price** over exactly **20 minutes**.
3. Bidders send ETH to the auction contract at any time while it is running.
4. The auction **clears early** as soon as the ETH committed is enough to buy the whole supply at the current price:
   `totalCommitted >= currentPrice × totalSupply`.
5. Everyone pays the same **clearing price**, even people who bid early when the price was higher. Each bidder gets `commitment / clearingPrice` tokens, and the rest of their ETH comes back to them.
6. The bid that crosses the threshold is only partly filled. Its unused ETH is refunded.
7. If 20 minutes pass without clearing, the clearing price is the reserve price. Unsold tokens are **burned**.
8. After the auction ends, each bidder calls `claim()` to withdraw their tokens and any refund (pull payments, no loops over bidders).

### Planned parameters

These live in [`frontend/src/config.ts`](frontend/src/config.ts) and must match the deployed contract.

| Parameter | Value |
| --- | --- |
| Token supply | 1,000 TLP |
| Start price | 0.001 ETH per TLP |
| Reserve price | 0.0001 ETH per TLP |
| Duration | 20 minutes |
| ETH needed to clear at start price | 1 ETH |
| ETH needed to clear at reserve price | 0.1 ETH |

The amounts are small on purpose, so the team can run full auctions with Sepolia test ETH.

## Architecture

```
            ┌──────────────────────────┐
  Bidder ──▶│  Frontend (React + Vite) │
 (MetaMask) └────────────┬─────────────┘
                         │ reads price, state, events
                         │ sends bid / finalize / claim
                         ▼
            ┌──────────────────────────┐     mints / transfers / burns
            │  DutchAuction.sol        │────────────────────────────▶ AuctionToken.sol
            │  price decay, clearing,  │                              (ERC20Burnable)
            │  refunds, burn, claims   │
            └──────────────────────────┘
```

### Contract interface (agreed at kickoff)

```solidity
// AuctionToken: ERC20Burnable, full supply minted to the auction contract
// DutchAuction:
function start() external;                    // owner only, starts the 20-minute timer
function bid() external payable;
function currentPrice() external view returns (uint256);
function finalize() external;                 // after 20 min or sold out; burns unsold tokens
function claim() external;                    // user pulls their tokens + ETH refund
// public views: startTime, endTime, clearingPrice, totalCommitted, commitments(address), finalized
event BidPlaced(address indexed bidder, uint256 amount, uint256 price);
event AuctionFinalized(uint256 clearingPrice, uint256 sold, uint256 burned);
event Claimed(address indexed bidder, uint256 tokens, uint256 refund);
```

### Security goals

- **Reentrancy:** `ReentrancyGuard` plus checks-effects-interactions on `claim()`. We demonstrate an attack on a deliberately vulnerable version and show that our version blocks it.
- **Timing:** bids are rejected before `start()`, after 20 minutes, and after the auction clears.
- **One-time actions:** `finalize()` runs once, and each bidder claims once.
- **Rounding:** integer division never leaves more tokens or ETH promised than the contract holds.

## Repository structure

```
.
├── contracts/     Solidity contracts, Foundry tests and deploy scripts   (to do)
├── frontend/      React + Vite dApp                                        (static UI done)
├── ai-logs/       Prompts and AI outputs, one file per session (for the AI Audit Report)
├── report/        AI Audit Report drafts                                    (to do)
└── spec.md        Our requirements, written before using AI                 (to do)
```

## Getting started

You need [Node.js](https://nodejs.org) 20 or newer and [MetaMask](https://metamask.io).

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173.

The frontend currently runs in **preview mode**:

- **Wallet connection is real.** "Connect wallet" opens MetaMask, the header shows your real address and Sepolia ETH balance, and a banner offers "Switch to Sepolia" if MetaMask is on another network.
- **The auction is simulated** in the browser, with fake bidders and a 1.5 ETH preview balance, so no real ETH is sent. The demo controls at the bottom let you skip ahead, finalize and restart.

When the contract is ready, we replace the mock hook in `frontend/src/hooks/useAuction.ts` with real contract calls (wagmi + viem). The components do not need to change.

#### Settings (optional)

Copy `frontend/.env.example` to `frontend/.env.local`:

| Variable | Use |
| --- | --- |
| `VITE_CHAIN` | `sepolia` (default) or `anvil` to test against a local node at `http://127.0.0.1:8545` |
| `VITE_SEPOLIA_RPC_URL` | Your own Alchemy/Infura URL if the public Sepolia RPC is slow |

#### Frontend code map

| Path | What it does |
| --- | --- |
| `src/wagmi.ts` | Networks (Sepolia, Anvil) and the MetaMask connector |
| `src/wallet/WalletContext.tsx` | Shared wallet state: connect, disconnect, switch network, readable error messages |
| `src/hooks/useAuction.ts` | The one switch between simulated and real contract data |
| `src/hooks/useMockAuction.ts` | The browser simulation |
| `src/lib/auction.ts` | Auction maths in bigint, mirroring the contract |
| `src/components/` | UI pieces: price clock, bid form, position, bid list… |

### Contracts

Coming next: Foundry setup in `contracts/`, with tests for price decay, early clearing, the threshold bid, refunds, burning and reentrancy.

```bash
# planned
cd contracts
forge build
forge test -vv
slither .
```

## Tech stack

| Part | Tools |
| --- | --- |
| Contracts | Solidity, OpenZeppelin, Foundry |
| Security | Slither, Foundry fuzz tests, manual review |
| Frontend | React, TypeScript, Vite (wagmi + viem next) |
| Network | Local Anvil for development, Sepolia testnet for the demo |

## Team

| Role | Owns | Member |
| --- | --- | --- |
| A – Contracts | Token and auction contracts, Foundry tests, Sepolia deploy | |
| B – Frontend | dApp UI, wallet connection, deploy scripts, README | |
| C – Security & Report | spec.md, prompt logs, Slither, reentrancy demo, AI Audit Report | |

## AI usage

The course allows AI tools but requires us to document how we used them. Every member saves their prompts and the AI's outputs in [`ai-logs/`](ai-logs/), using the template there. These logs feed Sections 3 and 5 of the AI Audit Report.

Bug workflow: GitHub issue → failing test → fix → passing test. Keep the test output as evidence.
