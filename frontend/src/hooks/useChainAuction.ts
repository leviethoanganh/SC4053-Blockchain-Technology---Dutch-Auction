import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useBlock, usePublicClient, useReadContracts, useWriteContract } from 'wagmi'
import { AUCTION_PARAMS as P, NETWORK_NAME, TARGET_CHAIN } from '../config'
import { AUCTION_DEPLOY_BLOCK, auction } from '../contracts/auction'
import {
  allocate,
  costOfSupply,
  demandPrice,
  priceAt,
  resolveAuction,
  timeWhenPriceReaches,
  tokensFor,
  tokensSold,
  type Outcome,
  type RawBid,
} from '../lib/auction'
import { describeTxError } from '../lib/txErrors'
import type { AuctionView, TxAction, TxState, UseAuctionResult } from '../types'
import { useWallet } from '../wallet/WalletContext'

/**
 * Live auction data from the deployed DutchAuction contract.
 *
 * - Reads (startTime, totalCommitted, clearingPrice, finalized) refresh on every new block.
 * - The bid list comes from BidPlaced events; your claim status from Claimed events.
 * - The clock follows BLOCK time, not your computer's clock, so the price shown
 *   matches what the contract will charge.
 * - Every write is simulated first, so a bid the contract would reject shows the
 *   contract's reason before MetaMask even opens.
 */

const chainId = TARGET_CHAIN.id

type FunctionName = 'start' | 'bid' | 'finalize' | 'claim'

export function useChainAuction(): UseAuctionResult {
  const wallet = useWallet()
  const me = wallet.isConnected ? wallet.address : undefined
  const client = usePublicClient({ chainId })
  const write = useWriteContract()
  const [tx, setTx] = useState<TxState>({ status: 'idle' })

  // ---- Block-time clock ---------------------------------------------------
  const { data: block } = useBlock({ chainId, watch: true })
  const offsetRef = useRef(0) // seconds the chain is ahead of this computer (Anvil time warps)
  useEffect(() => {
    if (block) offsetRef.current = Math.max(0, Number(block.timestamp) - Date.now() / 1000)
  }, [block])
  const [wallSec, setWallSec] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setWallSec(Date.now() / 1000), 250)
    return () => clearInterval(id)
  }, [])
  const chainNow = wallSec + offsetRef.current

  // ---- Contract state -------------------------------------------------------
  const reads = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...auction, chainId, functionName: 'startTime' },
      { ...auction, chainId, functionName: 'totalCommitted' },
      { ...auction, chainId, functionName: 'clearingPrice' },
      { ...auction, chainId, functionName: 'finalized' },
    ],
  })
  const { refetch: refetchReads } = reads
  useEffect(() => {
    if (block?.number !== undefined) void refetchReads()
  }, [block?.number, refetchReads])

  const blockKey = block?.number?.toString() ?? 'none'

  const bidLogs = useQuery({
    queryKey: ['auction-bids', auction.address, chainId, blockKey],
    enabled: Boolean(client && block),
    placeholderData: (prev) => prev,
    queryFn: () =>
      client!.getContractEvents({ ...auction, eventName: 'BidPlaced', fromBlock: AUCTION_DEPLOY_BLOCK, toBlock: block!.number }),
  })

  const myClaims = useQuery({
    queryKey: ['auction-claims', auction.address, chainId, me, blockKey],
    enabled: Boolean(client && block && me),
    placeholderData: (prev) => prev,
    queryFn: () =>
      client!.getContractEvents({
        ...auction,
        eventName: 'Claimed',
        args: { bidder: me },
        fromBlock: AUCTION_DEPLOY_BLOCK,
        toBlock: block!.number,
      }),
  })

  const isFinalized = reads.data?.[3] ?? false
  const finalLogs = useQuery({
    queryKey: ['auction-final', auction.address, chainId, isFinalized],
    enabled: Boolean(client && isFinalized),
    queryFn: () => client!.getContractEvents({ ...auction, eventName: 'AuctionFinalized', fromBlock: AUCTION_DEPLOY_BLOCK }),
  })

  // ---- Build the view ---------------------------------------------------
  const view: AuctionView = useMemo(() => {
    const [startTimeRaw = 0n, totalCommittedRaw = 0n, chainClearing = 0n, finalized = false] = reads.data ?? []
    const startTime = Number(startTimeRaw)
    const started = startTime > 0
    const elapsedSec = started ? Math.max(0, Math.floor(chainNow - startTime)) : 0

    // Bid list from events. The contract emits the price at bid time, and the
    // price falls linearly, so the second it happened can be read back from it.
    const bids: RawBid[] = (bidLogs.data ?? []).map((log) => ({
      id: `${log.transactionHash}-${log.logIndex}`,
      bidder: log.args.bidder!,
      amount: log.args.amount!,
      at: Math.min(timeWhenPriceReaches(P, log.args.price!), elapsedSec),
    }))
    const local = resolveAuction(P, bids, Math.max(elapsedSec, ...bids.map((b) => b.at)), started)

    // The chain is the source of truth for the clearing price when it has one.
    let phase = local.phase
    if (started && phase === 'live' && (chainClearing > 0n || finalized)) phase = 'cleared'
    const outcome: Outcome = {
      ...local,
      phase,
      clearingPrice: chainClearing > 0n ? chainClearing : local.clearingPrice,
      totalCommitted: totalCommittedRaw,
    }
    if (phase === 'cleared' && outcome.clearingPrice !== null && outcome.thresholdBidId === null && local.accepted.length > 0) {
      // Sold out by a bid: the last bid that crossed the line gets the excess back.
      const cost = costOfSupply(P, outcome.clearingPrice)
      if (totalCommittedRaw > cost) {
        outcome.thresholdBidId = local.accepted.at(-1)!.id
        outcome.thresholdExcess = totalCommittedRaw - cost
      }
    }

    const ended = phase === 'cleared' || phase === 'time-up'
    const livePrice = started ? priceAt(P, elapsedSec) : P.startPrice
    const currentPrice = ended && outcome.clearingPrice !== null ? outcome.clearingPrice : livePrice

    const finalEvent = finalLogs.data?.at(-1)?.args
    const sold = finalized ? (finalEvent?.sold ?? tokensSold(P, outcome)) : null

    let position: AuctionView['position'] = null
    if (me) {
      const claimLog = myClaims.data?.at(-1)?.args
      const a = allocate(outcome, me)
      if (claimLog) {
        position = { committed: a.committed, tokens: claimLog.tokens!, refund: claimLog.refund!, isEstimate: false, claimed: true }
      } else if (ended) {
        // The clearing price is fixed once bidding closes, so these are final numbers.
        position = { ...a, isEstimate: false, claimed: false }
      } else {
        position = { committed: a.committed, tokens: tokensFor(a.committed, livePrice), refund: 0n, isEstimate: true, claimed: false }
      }
    }

    return {
      mode: 'chain',
      phase,
      finalized,
      elapsedSec,
      remainingSec: ended ? 0 : started ? Math.max(0, P.durationSec - elapsedSec) : P.durationSec,
      durationSec: P.durationSec,
      startPrice: P.startPrice,
      reservePrice: P.reservePrice,
      currentPrice,
      clearingPrice: outcome.clearingPrice,
      totalSupply: P.totalSupply,
      totalCommitted: totalCommittedRaw,
      demandPrice: demandPrice(P, totalCommittedRaw),
      costAtCurrentPrice: costOfSupply(P, currentPrice),
      tokensSold: sold,
      tokensBurned: sold === null ? null : (finalEvent?.burned ?? P.totalSupply - sold),
      bids: outcome.accepted
        .map((b) => ({
          ...b,
          isMine: me !== undefined && b.bidder.toLowerCase() === me.toLowerCase(),
          isThreshold: b.id === outcome.thresholdBidId,
        }))
        .reverse(),
      account: me ? { address: me, balance: wallet.balance ?? 0n } : null,
      position,
    }
  }, [reads.data, chainNow, bidLogs.data, myClaims.data, finalLogs.data, me, wallet.balance])

  // ---- Writes -------------------------------------------------------------
  const refreshAll = useCallback(
    () => Promise.all([refetchReads(), bidLogs.refetch(), myClaims.refetch(), finalLogs.refetch()]),
    [refetchReads, bidLogs, myClaims, finalLogs],
  )

  const send = useCallback(
    async (action: TxAction, functionName: FunctionName, done: string, value?: bigint): Promise<boolean> => {
      if (!me || !client) {
        setTx({ status: 'error', action, message: 'Connect your wallet first.' })
        return false
      }
      if (wallet.wrongNetwork) {
        setTx({ status: 'error', action, message: `Switch MetaMask to ${NETWORK_NAME} first.` })
        return false
      }
      try {
        setTx({ status: 'pending', action, message: 'Checking with the contract…' })
        // Dry run: surfaces the contract's revert reason before MetaMask opens.
        await client.simulateContract({ ...auction, functionName, value, account: me } as never)
        // Gas depends on block time here (the price formula takes a shortcut at
        // second 0), so an exact estimate can run out of gas one block later.
        // Add a 20% buffer; unused gas is not charged.
        const estimate = await client.estimateContractGas({ ...auction, functionName, value, account: me } as never)
        const gas = (estimate * 120n) / 100n
        setTx({ status: 'pending', action, message: 'Confirm in MetaMask…' })
        const hash = await write.mutateAsync({ ...auction, functionName, value, chainId, gas } as never)
        setTx({ status: 'pending', action, message: 'Waiting for the network to confirm…' })
        const receipt = await client.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('The transaction was included but failed.')
        await refreshAll()
        setTx({ status: 'success', action, message: done })
        return true
      } catch (e) {
        setTx({ status: 'error', action, message: describeTxError(e, NETWORK_NAME) })
        return false
      }
    },
    [me, client, wallet.wrongNetwork, write, refreshAll],
  )

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
      bid: (amountWei: bigint) => {
        if (amountWei <= 0n) {
          setTx({ status: 'error', action: 'bid', message: 'Enter an amount above 0 ETH.' })
          return Promise.resolve(false)
        }
        return send('bid', 'bid', 'Bid placed.', amountWei)
      },
      finalize: async () => {
        await send('finalize', 'finalize', 'Auction finalized. Bidders can now claim.')
      },
      claim: async () => {
        await send('claim', 'claim', 'Tokens and refund sent to your wallet.')
      },
      start: async () => {
        await send('start', 'start', 'Auction started. The price is now falling.')
      },
    }),
    [wallet, send],
  )

  const problem = reads.error
    ? `Can't read the auction contract at ${auction.address} on ${NETWORK_NAME}. Check VITE_AUCTION_ADDRESS, and that the contract is deployed on this network.`
    : bidLogs.error
      ? `Can't load the bid history. If you are on Sepolia, set VITE_AUCTION_DEPLOY_BLOCK to the contract's deploy block.`
      : null

  return { view, actions, tx, status: reads.data ? 'ready' : reads.error ? 'error' : 'loading', problem }
}
