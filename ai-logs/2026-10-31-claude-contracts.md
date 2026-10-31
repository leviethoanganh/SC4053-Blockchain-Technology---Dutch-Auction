# Spec, contracts, tests and Slither

- **Date:** 2026-10-31
- **Member:** (add name). The contracts role was handed over by agreement with the contracts teammate.
- **Tool:** Claude (claude.ai, linked to the repo folder). Foundry 1.8.7, solc 0.8.28, OpenZeppelin v5.7.0, Slither 0.11.6.
- **Goal:** Write the spec, both contracts, a full Foundry test suite, run Slither, and connect the frontend to the real ABI.

## Prompts
1. "what i do next? can you start with contract now?"
2. Claude asked who should write the contract (it is the contracts teammate's role). Answer: "Teammate agreed I do it".

## Honest note for report Section 1
`spec.md` was **drafted by Claude** from the project brief (requirements quoted word for word) and from decisions made earlier with Claude (frontend rounding rules, interface). It was not written before any AI use. The team should review it, add anything it originally intended, and sign it off. Report Section 1 should say this plainly.

## What the AI produced
| File | Content |
| --- | --- |
| `spec.md` | Requirements R1–R8 from the brief, parameters, the 3 ways the auction ends, threshold refund, rounding rule, security requirements S1–S6, test plan |
| `contracts/src/AuctionToken.sol` | OpenZeppelin ERC20 + ERC20Burnable, fixed supply minted once to the auction |
| `contracts/src/DutchAuction.sol` | Linear price decay, bids, sell-out by bid (case A) or by falling price (case B), time-up with burn (case C), pull-based claims, owner proceeds; Ownable + ReentrancyGuard; custom errors |
| `contracts/test/DutchAuction.t.sol` | 31 tests incl. 1,000-run fuzz test of the accounting |
| `contracts/test/Reentrancy.t.sol` | Malicious bidder re-entering `claim()` |
| `contracts/script/Deploy.s.sol` | Deploy (and optionally start) on Anvil or Sepolia |
| `frontend/scripts/sync-abi.mjs` | Copies the real ABI into the frontend (`npm run sync-abi`) |
| `report/evidence/*` | Test output, coverage, Slither before/after |

## Problems found while building (candidates for report Section 5)

### 1. The reentrancy test passed even on a vulnerable contract
- **Why AI made the mistake:** the first test set up an attack where the contract held only 1.3 ETH and the attacker's refund was 0.75 ETH. A second refund was unaffordable, so the re-entered call failed for lack of funds, not because of the contract's protection.
- **Why it is problematic:** a test that passes on broken code gives false confidence. The bonus requirement (R7) would have been "proven" by a test that proves nothing.
- **How it was found:** mutation testing. The AI deliberately broke `claim()` (removed `nonReentrant` and paid before clearing the commitment) and the test still passed.
- **Fix:** rebuilt the scenario so the contract holds more than twice the refund (0.7 ETH held, 0.15 ETH refund). Added an assertion that the balance allows a double payout.
- **Evidence:**

  | `claim()` version | Reentrancy test |
  | --- | --- |
  | Real (guard + state cleared before paying) | PASS |
  | No guard + state cleared after paying (vulnerable) | **FAIL** (attacker paid twice) |
  | Guard only, state cleared after paying | PASS (guard alone blocks it) |

### 2. Slither: `arbitrary-send-eth`
- **Why:** ETH was sent through a helper `_sendEth(address to, uint256 amount)`. Slither could not see that `to` is always `msg.sender` (claim) or the owner (withdraw).
- **Fix:** send ETH inline to `msg.sender` in both functions; the helper was removed.
- **Evidence:** `report/evidence/2026-10-31-slither-before.txt` vs `...-slither-after.txt`. All 32 tests still pass.

### 3. Slither findings kept, with reasons
| Finding | Why it stays |
| --- | --- |
| `timestamp` | The brief requires a time-based auction. Validators can shift the timestamp by a few seconds, moving the price by about 0.00000075 ETH per token per second. |
| `incorrect-equality` (`startTime == 0`, `totalCommitted == 0`) | Sentinel checks for "not started" / "no bids", not balance comparisons. False positive. |
| `low-level-calls` | `.call` is the recommended way to send ETH (`.transfer`'s 2,300 gas breaks smart-contract wallets). Protected by `nonReentrant` and state cleared before sending. |

### 4. Gas estimate too low right after `start()` (found earlier, frontend Part B)
Fixed in the frontend with a 20% gas buffer. Still relevant to the real contract: `priceAt()` takes a shortcut at elapsed = 0, so gas differs between estimate and execution.

## Validation
- `forge test`: **32 passed, 0 failed** (`report/evidence/2026-10-31-forge-test.txt`)
- `forge coverage`: **100% lines, statements, branches, functions** for `DutchAuction.sol` (`...-forge-coverage.txt`)
- End-to-end on a local Anvil chain, page driven in a headless browser:
  - Sell-out: page predicted 888.83 TLP + 0.2205 ETH refund before finalize; the chain paid exactly that. Sum of all claimed TLP = 999.999999999999999999 (1 wei of dust stays in the contract by design).
  - Time up: 300 TLP sold, 700 burned, `totalSupply()` = 300 on-chain.
  - Non-owner start shows "Only the contract owner can do this."

## Still to do by the team
- [ ] Review and sign off `spec.md`
- [ ] Run `forge test` on your own machine and compare with the evidence file
- [ ] Deploy to Sepolia, verify on Etherscan, run a full auction with 3 wallets
- [ ] (Bonus, member C) a standalone demo: deploy a deliberately vulnerable copy and show the attack draining it, next to the real contract blocking it
