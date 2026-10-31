/**
 * Pure Dutch auction maths, written with bigint so it mirrors Solidity's
 * integer arithmetic. The mock uses it to simulate the contract, and the real
 * frontend can keep using it for estimates (e.g. "you get at least N tokens").
 *
 * Units: prices are wei per WHOLE token; token amounts are 18-decimal base units.
 */
import { WAD } from './format'

export interface AuctionParams {
  totalSupply: bigint
  startPrice: bigint
  reservePrice: bigint
  durationSec: number
}

export interface RawBid {
  id: string
  bidder: string
  amount: bigint // wei
  at: number // seconds since start
}

export interface AcceptedBid extends RawBid {
  price: bigint // price at the moment of the bid
}

export type Phase = 'not-started' | 'live' | 'cleared' | 'time-up'

export interface Outcome {
  phase: Phase
  endedAt: number | null // seconds since start
  clearingPrice: bigint | null
  accepted: AcceptedBid[]
  totalCommitted: bigint
  /** The bid that pushed demand over the supply, if the auction ended that way. */
  thresholdBidId: string | null
  /** ETH from the threshold bid that did not fit, refunded to that bidder. */
  thresholdExcess: bigint
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b

/** Linear decay from startPrice to reservePrice over durationSec. */
export function priceAt(p: AuctionParams, elapsedSec: number): bigint {
  if (elapsedSec <= 0) return p.startPrice
  if (elapsedSec >= p.durationSec) return p.reservePrice
  const drop = ((p.startPrice - p.reservePrice) * BigInt(Math.floor(elapsedSec))) / BigInt(p.durationSec)
  return p.startPrice - drop
}

/** ETH needed to buy the whole supply at `price`. */
export function costOfSupply(p: AuctionParams, price: bigint): bigint {
  return (price * p.totalSupply) / WAD
}

/**
 * The price at which `committed` ETH buys exactly the whole supply.
 * Rounded UP so the tokens handed out can never exceed the supply.
 */
export function demandPrice(p: AuctionParams, committed: bigint): bigint {
  return ceilDiv(committed * WAD, p.totalSupply)
}

/** First whole second at which the falling price is at or below `price`. */
export function timeWhenPriceReaches(p: AuctionParams, price: bigint): number {
  if (price >= p.startPrice) return 0
  if (price < p.reservePrice) return Number.POSITIVE_INFINITY
  const range = p.startPrice - p.reservePrice
  return Number(ceilDiv((p.startPrice - price) * BigInt(p.durationSec), range))
}

/** Tokens (base units) that `amountWei` buys at `price`. Rounded down. */
export function tokensFor(amountWei: bigint, price: bigint): bigint {
  if (price === 0n) return 0n
  return (amountWei * WAD) / price
}

/**
 * Replay the bids in order and work out where the auction stands at `elapsedSec`.
 * This is the behaviour we expect from the contract.
 */
export function resolveAuction(p: AuctionParams, bids: RawBid[], elapsedSec: number, started = true): Outcome {
  const base: Outcome = {
    phase: started ? 'live' : 'not-started',
    endedAt: null,
    clearingPrice: null,
    accepted: [],
    totalCommitted: 0n,
    thresholdBidId: null,
    thresholdExcess: 0n,
  }
  if (!started) return base

  const horizon = Math.min(elapsedSec, p.durationSec)
  const sorted = [...bids].filter((b) => b.at <= elapsedSec).sort((a, b) => a.at - b.at)
  let committed = 0n
  const accepted: AcceptedBid[] = []

  // Has the price already fallen to where current demand buys everything?
  const crossedBy = (t: number) => {
    if (committed === 0n) return null
    const d = demandPrice(p, committed)
    if (d < p.reservePrice) return null
    const tD = timeWhenPriceReaches(p, d)
    return tD <= t ? { at: tD, price: d } : null
  }

  for (const bid of sorted) {
    if (bid.at >= p.durationSec) break
    const crossed = crossedBy(bid.at)
    if (crossed) {
      return { ...base, phase: 'cleared', endedAt: crossed.at, clearingPrice: crossed.price, accepted, totalCommitted: committed }
    }
    const price = priceAt(p, bid.at)
    committed += bid.amount
    accepted.push({ ...bid, price })
    const cost = costOfSupply(p, price)
    if (committed >= cost) {
      return {
        ...base,
        phase: 'cleared',
        endedAt: bid.at,
        clearingPrice: price,
        accepted,
        totalCommitted: committed,
        thresholdBidId: bid.id,
        thresholdExcess: committed - cost,
      }
    }
  }

  const crossed = crossedBy(horizon)
  if (crossed) {
    return { ...base, phase: 'cleared', endedAt: crossed.at, clearingPrice: crossed.price, accepted, totalCommitted: committed }
  }
  if (elapsedSec >= p.durationSec) {
    return { ...base, phase: 'time-up', endedAt: p.durationSec, clearingPrice: p.reservePrice, accepted, totalCommitted: committed }
  }
  return { ...base, accepted, totalCommitted: committed }
}

export interface Allocation {
  committed: bigint
  tokens: bigint
  refund: bigint
}

/**
 * What one address receives once the clearing price is known.
 * Cost is rounded UP, so any rounding dust stays in the contract instead of
 * the contract owing more ETH than it holds.
 */
export function allocate(outcome: Outcome, address: string): Allocation {
  const mine = outcome.accepted.filter((b) => b.bidder.toLowerCase() === address.toLowerCase())
  const committed = mine.reduce((sum, b) => sum + b.amount, 0n)
  if (outcome.clearingPrice === null) return { committed, tokens: 0n, refund: 0n }
  const usable = mine.reduce(
    (sum, b) => sum + b.amount - (b.id === outcome.thresholdBidId ? outcome.thresholdExcess : 0n),
    0n,
  )
  const tokens = tokensFor(usable, outcome.clearingPrice)
  const cost = ceilDiv(tokens * outcome.clearingPrice, WAD)
  return { committed, tokens, refund: committed - cost }
}

/** Tokens sold in total once the auction has ended. */
export function tokensSold(p: AuctionParams, outcome: Outcome): bigint {
  if (outcome.clearingPrice === null) return 0n
  if (outcome.phase === 'cleared') return p.totalSupply
  const sold = tokensFor(outcome.totalCommitted, outcome.clearingPrice)
  return sold > p.totalSupply ? p.totalSupply : sold
}
