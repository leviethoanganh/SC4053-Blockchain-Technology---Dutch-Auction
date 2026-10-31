# Real MetaMask connection (frontend Part A)

- **Date:** 2026-10-31
- **Member:** (add name)
- **Tool:** Claude (claude.ai, linked to the repo folder)
- **Goal:** Replace the fake wallet with a real MetaMask connection, before the contract exists.

## Prompts
1. "so what do i do next after frontend part?"
2. "i have pushed code. give me the instruction for next step"
3. "you can do the part A for me. i will test later"

## What the AI produced
- `src/wagmi.ts`: wagmi v3 config for Sepolia and local Anvil (chain 31337), injected (MetaMask) connector.
- `src/wallet/WalletContext.tsx`: one shared wallet state (connect, disconnect, switch network, balance) with readable error messages.
- `src/components/WalletButton.tsx`, `WalletNotice.tsx`: header button and the banner for wrong network / errors.
- `useMockAuction.ts` now records preview bids under the real connected address.
- `.env.example` with `VITE_CHAIN` and `VITE_SEPOLIA_RPC_URL`.

## Things to note for the report
- Most online examples are for wagmi v2. In v3, actions use `.mutate()` and `useAccount` is renamed `useConnection`. The AI checked the installed package's API before writing code.
- Hook state is per component in React, so a connect error raised in one button would not show in another. The AI moved wallet state into one React context to avoid that.

## What we checked or changed
- [ ] Tested with real MetaMask on Sepolia: connect, balance shows, disconnect
- [ ] Tested wrong network → "Switch to Sepolia" works
- [ ] Tested pressing Reject in MetaMask → readable message

## Evidence
- `npm run build` passes.
- Headless browser test with a stand-in wallet: connect on Sepolia, wrong network then switch, user rejects, and no MetaMask installed all show the expected screens.
