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

### Contract interface

The full rules are in [`spec.md`](spec.md).

```solidity
// AuctionToken: ERC20 + ERC20Burnable. The whole supply is minted to the auction at deploy.
// DutchAuction: Ownable + ReentrancyGuard. Creates the token in its constructor.
function start() external;                    // owner only, once: starts the 20-minute timer
function bid() external payable;              // while live and not sold out
function currentPrice() external view returns (uint256);
function finalize() external;                 // anyone, once, after sell-out or 20 min; burns unsold
function claim() external;                    // each bidder once: tokens + ETH refund (pull)
function withdrawProceeds() external;         // owner: sale proceeds from claims so far
// views: token, startPrice, reservePrice, totalSupply, DURATION, startTime, endTime,
//        clearingPrice, totalCommitted, finalized, soldOut, isSoldOut(), hasEnded(),
//        commitments(address), thresholdBidder, thresholdExcess, proceeds, demandPrice()
event AuctionStarted(uint256 startTime, uint256 endTime);
event BidPlaced(address indexed bidder, uint256 amount, uint256 price);
event AuctionFinalized(uint256 clearingPrice, uint256 sold, uint256 burned);
event Claimed(address indexed bidder, uint256 tokens, uint256 refund);
event ProceedsWithdrawn(address indexed to, uint256 amount);
// errors: NotStarted, AlreadyStarted, AuctionEnded, SoldOut, ZeroBid, AuctionStillRunning,
//         AlreadyFinalized, NotFinalized, NothingToClaim, NothingToWithdraw, EthTransferFailed
```

### Security goals

- **Reentrancy:** `ReentrancyGuard` plus checks-effects-interactions on `claim()` and `withdrawProceeds()`. `test/Reentrancy.t.sol` attacks `claim()` with a malicious contract and shows the attack is blocked.
- **Timing:** bids are rejected before `start()`, after 20 minutes, and after the auction clears.
- **One-time actions:** `finalize()` runs once, and each bidder claims once.
- **Rounding:** integer division never leaves more tokens or ETH promised than the contract holds.

## Repository structure

```
.
├── contracts/          Foundry project
│   ├── src/            AuctionToken.sol, DutchAuction.sol
│   ├── test/           Unit, fuzz and reentrancy tests
│   └── script/         Deploy.s.sol
├── frontend/           React + Vite dApp (preview mode + live contract mode)
├── ai-logs/            Prompts and AI outputs, one file per session
├── report/evidence/    Test, coverage and Slither outputs for the AI Audit Report
└── spec.md             Requirements and auction rules (the spec given to AI tools)
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

The frontend has two modes, chosen by `frontend/.env.local`:

| Mode | When | What happens |
| --- | --- | --- |
| **Preview** | `VITE_AUCTION_ADDRESS` is empty (default) | The wallet connection is real, but the auction is simulated in the browser with fake bidders and a 1.5 ETH preview balance. Demo controls let you skip ahead. |
| **Live** | `VITE_AUCTION_ADDRESS` is set | Reads the deployed `DutchAuction` contract and sends real transactions through MetaMask (start, bid, finalize, claim). |

Restart `npm run dev` after changing `.env.local`.

#### Run the frontend against a local contract (Anvil)

1. In **Git Bash**, start a local chain: `anvil --block-time 1`. Keep it running.
2. Deploy the contracts to it, e.g. `forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil key 0>`.
3. Create `frontend/.env.local`:
   ```
   VITE_CHAIN=anvil
   VITE_AUCTION_ADDRESS=0x...   # the DutchAuction address printed by the deploy
   VITE_AUCTION_DEPLOY_BLOCK=0
   ```
4. In MetaMask, import 2–3 of the private keys that `anvil` prints (Account menu → Add account → Private key). **These keys are public test keys: never send real ETH to them.**
5. `npm run dev`, connect, and click **Switch to Local Anvil** when the banner asks. If MetaMask complains about a nonce after you restart Anvil, use Settings → Advanced → Clear activity tab data.

For Sepolia, set `VITE_CHAIN=sepolia`, the deployed address, and `VITE_AUCTION_DEPLOY_BLOCK` (the deploy block from Etherscan; public RPCs refuse to search events from block 0).

#### What the frontend expects from the contract

These are the assumptions in `frontend/src/hooks/useChainAuction.ts`. If the contract differs, tell the frontend owner.

- The ABI in `frontend/src/contracts/DutchAuction.abi.ts` is generated from the build. **After any contract change:** `forge build` in `contracts/`, then `npm run sync-abi` in `frontend/`.
- `startTime()` is `0` until `start()` is called.
- `BidPlaced.price` is the price at the moment of the bid. The page uses it to place the bid on the clock.
- `clearingPrice()` is `0` until known. It can be set by the bid that sells out, or by `finalize()`.
- `AuctionFinalized(clearingPrice, sold, burned)` and `Claimed(bidder, tokens, refund)` carry the real numbers. The page shows them.
- Custom errors are turned into plain sentences in `frontend/src/lib/txErrors.ts`. Add new errors there.
- Prices, supply and duration are read from the contract. `frontend/src/config.ts` is used only in preview mode and while loading.

#### Settings (optional)

Copy `frontend/.env.example` to `frontend/.env.local`:

| Variable | Use |
| --- | --- |
| `VITE_CHAIN` | `sepolia` (default) or `anvil` to test against a local node at `http://127.0.0.1:8545` |
| `VITE_AUCTION_ADDRESS` | Deployed `DutchAuction` address. Empty = preview mode |
| `VITE_AUCTION_DEPLOY_BLOCK` | Block the auction was deployed in (needed on Sepolia) |
| `VITE_SEPOLIA_RPC_URL` | Your own Alchemy/Infura URL if the public Sepolia RPC is slow |

#### Frontend code map

| Path | What it does |
| --- | --- |
| `src/wagmi.ts` | Networks (Sepolia, Anvil) and the MetaMask connector |
| `src/wallet/WalletContext.tsx` | Shared wallet state: connect, disconnect, switch network, readable error messages |
| `src/hooks/useAuction.ts` | The one switch between simulated and real contract data |
| `src/hooks/useChainAuction.ts` | Live data from the contract: reads, events, transactions |
| `src/hooks/useMockAuction.ts` | The browser simulation |
| `src/contracts/auction.ts` | Contract address and deploy block |
| `src/contracts/DutchAuction.abi.ts` | ABI, generated by `npm run sync-abi` (do not edit) |
| `src/lib/txErrors.ts` | Turns MetaMask and contract errors into readable messages |
| `src/lib/auction.ts` | Auction maths in bigint, mirroring the contract |
| `src/components/` | UI pieces: price clock, bid form, position, bid list… |

### Contracts

Run these in **Git Bash** (Foundry does not run in PowerShell or Command Prompt).

**One-time setup:** install the libraries (OpenZeppelin and forge-std, as git submodules):

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 foundry-rs/forge-std@v1.17.0
```

After cloning the repo on another computer, use `git submodule update --init --recursive` instead.

**Build, test, check:**

```bash
forge build
forge test -vv                                           # 32 tests, incl. fuzz + reentrancy attack
forge coverage --no-match-coverage "test|script"         # 100% lines and branches
slither . --filter-paths "lib/|test/|script/"            # needs: pip install slither-analyzer
```

| Test file | What it proves |
| --- | --- |
| `test/DutchAuction.t.sol` | Price decay, every bidding rule, all three endings (sell-out by a bid, price falls to demand, time runs out + burn), threshold refund, same price for everyone, claim/finalize once, owner-only actions, and a fuzz test (1,000 random runs) that tokens out ≤ tokens sold and ETH out ≤ ETH in |
| `test/Reentrancy.t.sol` | A malicious bidder re-enters `claim()` from its `receive()` and is blocked; it gets exactly one refund and other bidders are unaffected |

**Deploy to Anvil** (local), with `anvil --block-time 1` running in another window:

```bash
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

That key is Anvil's public test account 0, safe only on Anvil. Add `START_AUCTION=true` in front of the command to start the 20-minute timer right away. The script prints the `DutchAuction` address and the deploy block for `frontend/.env.local`.

**Deploy to Sepolia:** never paste a real private key into a command or a file in this repo. Store it encrypted once, then refer to it by name:

```bash
cast wallet import deployer --interactive         # paste the key of a wallet with Sepolia ETH
forge script script/Deploy.s.sol --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --account deployer --broadcast
```

#### Known limitations

- A bidder **contract** that cannot receive ETH and is owed a refund cannot claim (the whole claim reverts, so nothing is lost). Normal wallets and MetaMask are unaffected.
- Rounding leaves a few wei of tokens/ETH in the contract (tokens round down, cost rounds up), so it can never owe more than it holds.
- Validators can shift `block.timestamp` by a few seconds; the price moves about 0.00000075 ETH per token per second, which is negligible.

## Tech stack

| Part | Tools |
| --- | --- |
| Contracts | Solidity, OpenZeppelin, Foundry |
| Security | Slither, Foundry fuzz tests, manual review |
| Frontend | React, TypeScript, Vite, wagmi + viem |
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
