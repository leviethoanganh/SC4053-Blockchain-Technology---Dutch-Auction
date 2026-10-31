import { useCallback, useEffect, useMemo, useState } from 'react'
import { AUCTION_PARAMS as P } from '../config'
import {
  allocate,
  costOfSupply,
  demandPrice,
  priceAt,
  resolveAuction,
  tokensFor,
  tokensSold,
  type RawBid,
} from '../lib/auction'
import { parseEth } from '../lib/format'
import type { AuctionView, TxAction, TxState, UseAuctionResult } from '../types'
import { useWallet } from '../wallet/WalletContext'

/**
 * Browser-only simulation of the auction contract, for building the UI before
 * deployment. Time runs for real; demo controls can skip ahead.
 *
 * The wallet connection is REAL (MetaMask via wagmi): bids are recorded under
 * your real address. The auction itself and the bidding balance are simulated,
 * so no ETH ever leaves your wallet in preview mode.
 */

const PREVIEW_BALANCE = parseEth('1.5')
const STARTED_MINUTES_AGO = 6

// Other bidders. They appear in the feed as the clock reaches their time.
const SEED_BIDS: RawBid[] = [
  { id: 's1', bidder: '0x51C4e8a0f3B9d2E7a6C1b0D9e8F7a6B5c4D3e2F1', amount: parseEth('0.04'), at: 15 },
  { id: 's2', bidder: '0x9E02b7C6d5A4f3E2b1C0a9D8e7F6a5B4c3D2e1A0', amount: parseEth('0.025'), at: 70 },
  { id: 's3', bidder: '0x3dA1f0E9c8B7a6D5e4F3a2B1c0D9e8F7a6B5c4D3', amount: parseEth('0.06'), at: 140 },
  { id: 's4', bidder: '0xC7b6A5d4E3f2A1b0C9d8E7f6A5b4C3d2E1f0A9b8', amount: parseEth('0.05'), at: 222 },
  { id: 's5', bidder: '0x51C4e8a0f3B9d2E7a6C1b0D9e8F7a6B5c4D3e2F1', amount: parseEth('0.035'), at: 301 },
  { id: 's6', bidder: '0x0B8e7D6c5F4a3E2d1C0b9A8f7E6d5C4b3A2f1E0d', amount: parseEth('0.03'), at: 460 },
  { id: 's7', bidder: '0x6F5e4D3c2B1a0F9e8D7c6B5a4F3e2D1c0B9a8F7e', amount: parseEth('0.045'), at: 610 },
]

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function useMockAuction(): UseAuctionResult {
  const [startMs, setStartMs] = useState(() => Date.now() - STARTED_MINUTES_AGO * 60_000)
  const [offsetMs, setOffsetMs] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [myBids, setMyBids] = useState<RawBid[]>([])
  const wallet = useWallet()
  const me = wallet.isConnected ? wallet.address : undefined
  const connected = Boolean(me)
  const [balance, setBalance] = useState(PREVIEW_BALANCE)
  const [finalized, setFinalized] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [tx, setTx] = useState<TxState>({ status: 'idle' })

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  const elapsedSec = Math.max(0, Math.floor((nowMs + offsetMs - startMs) / 1000))
  const allBids = useMemo(() => [...SEED_BIDS, ...myBids], [myBids])
  const outcome = useMemo(() => resolveAuction(P, allBids, elapsedSec), [allBids, elapsedSec])

  const view: AuctionView = useMemo(() => {
    const ended = outcome.phase === 'cleared' || outcome.phase === 'time-up'
    const livePrice = priceAt(P, elapsedSec)
    const currentPrice = ended && outcome.clearingPrice !== null ? outcome.clearingPrice : livePrice
    const sold = finalized ? tokensSold(P, outcome) : null

    let position: AuctionView['position'] = null
    if (me) {
      const a = allocate(outcome, me)
      position = ended
        ? { ...a, isEstimate: false, claimed }
        : { committed: a.committed, tokens: tokensFor(a.committed, livePrice), refund: 0n, isEstimate: true, claimed }
    }

    return {
      mode: 'preview',
      phase: outcome.phase,
      finalized,
      elapsedSec,
      remainingSec: ended ? 0 : Math.max(0, P.durationSec - elapsedSec),
      durationSec: P.durationSec,
      startPrice: P.startPrice,
      reservePrice: P.reservePrice,
      currentPrice,
      clearingPrice: outcome.clearingPrice,
      totalSupply: P.totalSupply,
      totalCommitted: outcome.totalCommitted,
      demandPrice: demandPrice(P, outcome.totalCommitted),
      costAtCurrentPrice: costOfSupply(P, currentPrice),
      tokensSold: sold,
      tokensBurned: sold === null ? null : P.totalSupply - sold,
      bids: outcome.accepted
        .map((b) => ({
          ...b,
          isMine: me !== undefined && b.bidder.toLowerCase() === me.toLowerCase(),
          isThreshold: b.id === outcome.thresholdBidId,
        }))
        .reverse(),
      account: me ? { address: me, balance } : null,
      position,
    }
  }, [outcome, elapsedSec, finalized, me, balance, claimed])

  const run = useCallback(async (action: TxAction, pending: string, ms: number, work: () => string) => {
    setTx({ status: 'pending', action, message: pending })
    await wait(ms)
    try {
      setTx({ status: 'success', action, message: work() })
      return true
    } catch (e) {
      setTx({ status: 'error', action, message: (e as Error).message })
      return false
    }
  }, [])

  const reject = (action: TxAction, message: string) => {
    setTx({ status: 'error', action, message })
    return false
  }

  const actions = useMemo(
    () => ({
      connect: () => {
        setTx({ status: 'idle' })
        wallet.connect()
      },
      disconnect: () => {
        setTx({ status: 'idle' })
        wallet.disconnect()
      },
      bid: async (amountWei: bigint) => {
        if (!connected || !me) return reject('bid', 'Connect your wallet first.')
        if (view.phase !== 'live') return reject('bid', 'Bidding is closed. The auction has ended.')
        if (amountWei <= 0n) return reject('bid', 'Enter an amount above 0 ETH.')
        if (amountWei > balance) return reject('bid', 'Your wallet does not have enough ETH for this bid.')
        return run('bid', 'Confirm the bid in your wallet…', 1200, () => {
          const at = Math.max(0, Math.floor((Date.now() + offsetMs - startMs) / 1000))
          setMyBids((prev) => [...prev, { id: `me-${prev.length + 1}`, bidder: me, amount: amountWei, at }])
          setBalance((b) => b - amountWei)
          return 'Bid placed.'
        })
      },
      finalize: async () => {
        if (view.phase === 'live' || view.phase === 'not-started') {
          return setTx({ status: 'error', action: 'finalize', message: 'The auction can be finalized once it sells out or time runs out.' })
        }
        await run('finalize', 'Finalizing the auction…', 1000, () => {
          setFinalized(true)
          return 'Auction finalized. Bidders can now claim.'
        })
      },
      claim: async () => {
        const pos = view.position
        if (!pos || !view.finalized || pos.claimed || pos.committed === 0n) return
        await run('claim', 'Confirm the claim in your wallet…', 1200, () => {
          setClaimed(true)
          setBalance((b) => b + pos.refund)
          return 'Tokens and refund sent to your wallet.'
        })
      },
    }),
    [connected, me, wallet, view, balance, offsetMs, startMs, run],
  )

  const demo = useMemo(
    () => ({
      skip: (seconds: number) => setOffsetMs((o) => o + seconds * 1000),
      restart: () => {
        setStartMs(Date.now())
        setNowMs(Date.now())
        setOffsetMs(0)
        setMyBids([])
        setBalance(PREVIEW_BALANCE)
        setFinalized(false)
        setClaimed(false)
        setTx({ status: 'idle' })
      },
    }),
    [],
  )

  return { view, actions, tx, demo }
}
