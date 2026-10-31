# README and static frontend

- **Date:** 2026-10-31
- **Member:** (add name)
- **Tool:** Claude (claude.ai, linked to the repo folder)
- **Goal:** Write the project README and a first static version of the frontend that works before the contracts exist.

## Prompts
1. "can you start with updating readme and doing the frontend (you can start with static UI first)"

Earlier in the same chat we asked Claude to explain the project brief and to plan a 10-day schedule for 3 people.

## What the AI produced
- `README.md`: auction rules, planned parameters, architecture, agreed contract interface, setup steps, team roles.
- `ai-logs/README.md`: this logging template.
- `frontend/`: Vite + React + TypeScript app running in **preview mode** (simulated auction in the browser).
  - `src/lib/auction.ts`: auction maths in bigint, mirroring Solidity integer division (price decay, early clearing, threshold bid refund, allocation, burn).
  - `src/hooks/useMockAuction.ts`: the simulation; `src/hooks/useAuction.ts` is the single switch point for the real contract hook later.
  - Components: price clock, bid form, demand bar, finalize panel, position panel, bid feed, how-it-works, demo controls.

## Design decisions the AI made (review these)
- Clearing price when the falling price meets demand = `ceil(totalCommitted * 1e18 / totalSupply)`, rounded **up** so tokens handed out never exceed the supply.
- A bidder's cost = `ceil(tokens * clearingPrice / 1e18)`, so rounding dust stays in the contract rather than the contract owing ETH.
- Bids are aggregated per address; the threshold bid's excess is refunded to that bidder.
- Parameters (1,000 TLP, 0.001 → 0.0001 ETH, 20 min) were chosen to be cheap on Sepolia. **The contract must use the same values or the UI must read them from chain.**

## What we checked or changed
- [ ] Contract team: confirm the rounding rules above match `DutchAuction.sol`, or change `auction.ts`.
- [ ] Check the simulation against the Foundry tests once they exist.

## Evidence
- `npm run build` passes (TypeScript strict mode).
- Manual run in a headless browser: bid → sell-out → finalize → claim works; a 1 ETH bid that crosses the threshold is partly refunded (≈0.518 ETH used for ≈711.7 TLP, ≈0.482 ETH refunded).
