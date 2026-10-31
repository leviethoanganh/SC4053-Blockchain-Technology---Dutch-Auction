# Connect the frontend to the contract (frontend Part B)

- **Date:** 2026-10-31
- **Member:** (add name)
- **Tool:** Claude (claude.ai, linked to the repo folder)
- **Goal:** Make the page read and write the real DutchAuction contract, before our contract was finished.

## Prompts
1. "i am done. i think we can start part B now, right?"

## What the AI produced
- `src/contracts/auction.ts`: ABI written from the interface in the README, plus address and deploy block from `.env.local`.
- `src/hooks/useChainAuction.ts`: reads contract state every block, builds the bid list from `BidPlaced` events, claim status from `Claimed` events, and sends start / bid / finalize / claim through MetaMask.
- `src/lib/txErrors.ts`: readable messages for "user rejected", contract revert reasons, and insufficient funds.
- `src/components/StartPanel.tsx`: "Start auction (owner only)" before the auction begins.
- `useAuction.ts` picks live mode when `VITE_AUCTION_ADDRESS` is set, otherwise preview mode.

## How it was tested
The AI wrote a throwaway stand-in contract (not in our repo; our real contract is written by the contracts member) following the same interface, deployed it to a local Anvil chain, and drove the page in a headless browser with a stand-in wallet that forwarded to Anvil.

| Scenario | Result |
| --- | --- |
| Connect, owner clicks Start | Page switches from "not started" to live, clock runs on block time |
| Bid 0.1 ETH from the page, 2 more bids from other accounts | All 3 appear in the bid list with the right prices |
| A 1 ETH bid sells out the auction | "Sold out at 0.000973 ETH", the bid is tagged as partly refunded |
| Finalize, then claim | Page shows 887.03 TLP + 0.23625 ETH refund; the chain shows the same 887.03 TLP balance |
| Non-owner clicks Start | "The contract refused: Only owner." |
| Time runs out with 0.03 ETH bid | "Time is up", finalize sells 300 TLP and burns 700; matches the chain |

## Problems found (candidates for report Section 5)
1. **Out of gas on the first bid right after `start()`.** The gas estimate was taken in the same second as `start()`, when the price function takes a shortcut (`elapsed == 0`). One block later the full formula runs and costs more gas, so the transaction ran out of gas, while the estimate looked fine. **Fix:** the frontend adds a 20% gas buffer to every transaction. **Lesson:** gas that depends on `block.timestamp` can differ between estimate and execution.
2. **Wrong wording after sell-out.** Between sell-out and finalize, "Your position" still said "Tokens, at least" and "Refund known when the auction ends", although the numbers were already final. Fixed in `useChainAuction.ts`.

## What we still need to check
- [ ] Replace the ABI with the real one from `forge build` and re-test on Anvil
- [ ] Confirm our contract matches "What the frontend expects from the contract" in the README
- [ ] Test on Sepolia with real MetaMask and 3 team wallets
