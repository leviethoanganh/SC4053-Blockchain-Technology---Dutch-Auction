import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { zeroAddress } from 'viem'
import { useBlock, usePublicClient, useReadContracts, useWriteContract } from 'wagmi'
import { AUCTION_PARAMS, NETWORK_NAME, TARGET_CHAIN } from '../config'
import { AUCTION_DEPLOY_BLOCK, auction } from '../contracts/auction'
import {
  costOfSupply,
  demandPrice,
  priceAt,
  settle,
  timeWhenPriceReaches,
  tokensFor,
  type AuctionParams,
  type Phase,
} from '../lib/auction'
import { describeTxError } from '../lib/txErrors'
import type { AuctionView, FeedBid, TxAction, TxState, UseAuctionResult } from '../types'
import { useWallet } from '../wallet/WalletContext'

/**
 * Live auction data from the deployed DutchAuction contract.
 *
 * - Contract state (prices, totals, sold-out flag, threshold bidder) refreshes every block.
 * - The bid list comes from BidPlaced events; your claim from Claimed events;
 *   sold/burned from AuctionFinalized.
 * - The clock follows BLOCK time, not this computer's clock, so the price shown is
 *   the price the contract will use.
 * - Every write is simulated first (shows the contract's error before MetaMask opens)
 *   and sent with a 20% gas buffer.
 */

const chainId = TARGET_CHAIN.id

type FunctionName = 'start' | 'bid' | 'finalize' | 'claim'

export function useChainAuction(): UseAuctionResult {
  const wallet = useWallet()
  const me = wallet.isConnected ? wallet.address : undefined
  const client = usePublicClient({ chainId })
  const write = useWriteContract()
  const [tx, setTx] = useState<TxState>({ status: 'idle' })

  // ---- Block-time clock -----------------------------------------------------
  const { data: block } = useBlock({ chainId, watch: true })
  const offsetRef = useRef(0) // seconds the chain is ahead of this computer (e.g. Anvil time warps)
  useEffect(() => {
    if (block) offsetRef.current = Math.max(0, Number(block.timestamp) - Date.now() / 1000)
  }, [block])
  const [wallSec, setWallSec] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = setInterval(() => setWallSec(Date.now() / 1000), 250)
    return () => clearInterval(id)
  }, [])
  const chainNow = wallSec + offsetRef.current

  // ---- Contract state ---------------------------------------------------------
  const reads = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...auction, chainId, functionName: 'startTime' },
      { ...auction, chainId, functionName: 'totalCommitted' },
      { ...auction, chainId, functionName: 'clearingPrice' },
      { ...auction, chainId, functionName: 'finalized' },
      { ...auction, chainId, functionName: 'isSoldOut' },
      { ...auction, chainId, functionName: 'thresholdBidder' },
      { ...auction, chainId, functionName: 'thresholdExcess' },
      { ...auction, chainId, functionName: 'startPrice' },
      { ...auction, chainId, functionName: 'reservePrice' },
      { ...auction, chainId, functionName: 'totalSupply' },
      { ...auction, chainId, functionName: 'DURATION' },
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

  // ---- Build the view -----------------------------------------------------------
  const view: AuctionView = useMemo(() => {
    const d = reads.data
    // Auction settings come from the contract itself; config.ts is only a fallback while loading.
    const P: AuctionParams = d
      ? { startPrice: d[7], reservePrice: d[8], totalSupply: d[9], durationSec: Number(d[10]) }
      : AUCTION_PARAMS
    const startTime = Number(d?.[0] ?? 0n)
    const totalCommitted = d?.[1] ?? 0n
    const chainClearing = d?.[2] ?? 0n
    const finalized = d?.[3] ?? false
    const chainSoldOut = d?.[4] ?? false
    const thresholdBidder = d?.[5] ?? zeroAddress
    const thresholdExcess = d?.[6] ?? 0n

    const started = startTime > 0
    const elapsedSec = started ? Math.max(0, Math.floor(chainNow - startTime)) : 0
    const livePrice = started ? priceAt(P, elapsedSec) : P.startPrice
    const demand = demandPrice(P, totalCommitted)

    // Sold out by a bid (case A), or the price has fallen to meet demand (case B).
    const soldOutByDemand = started && totalCommitted > 0n && demand >= P.reservePrice && livePrice <= demand
    let phase: Phase = 'not-started'
    if (started) {
      if (chainSoldOut || soldOutByDemand) phase = 'cleared'
      else if (finalized || elapsedSec >= P.durationSec) phase = 'time-up'
      else phase = 'live'
    }
    const ended = phase === 'cleared' || phase === 'time-up'

    // Clearing price: from the contract once set; otherwise what finalize() will set.
    let clearingPrice: bigint | null = chainClearing > 0n ? chainClearing : null
    if (clearingPrice === null && phase === 'cleared') clearingPrice = demand
    if (clearingPrice === null && phase === 'time-up') clearingPrice = P.reservePrice
    const currentPrice = ended && clearingPrice !== null ? clearingPrice : livePrice

    // Bid list. The contract emits the price at bid time, and the price falls linearly,
    // so the second of each bid can be read back from its price.
    const logs = bidLogs.data ?? []
    const isThresholdBidder = (a: string) => thresholdBidder !== zeroAddress && a.toLowerCase() === thresholdBidder.toLowerCase()
    let lastThresholdIndex = -1
    logs.forEach((l, i) => {
      if (isThresholdBidder(l.args.bidder!)) lastThresholdIndex = i
    })
    const bids: FeedBid[] = logs
      .map((log, i) => ({
        id: `${log.transactionHash}-${log.logIndex}`,
        bidder: log.args.bidder!,
        amount: log.args.amount!,
        price: log.args.price!,
        at: Math.min(timeWhenPriceReaches(P, log.args.price!), Math.max(elapsedSec, 0)),
        isMine: me !== undefined && log.args.bidder!.toLowerCase() === me.toLowerCase(),
        isThreshold: i === lastThresholdIndex,
      }))
      .reverse()

    // Your position
    let position: AuctionView['position'] = null
    if (me) {
      const committed = bids.filter((b) => b.isMine).reduce((sum, b) => sum + b.amount, 0n)
      const claimLog = myClaims.data?.at(-1)?.args
      if (claimLog) {
        position = { committed, tokens: claimLog.tokens!, refund: claimLog.refund!, isEstimate: false, claimed: true }
      } else if (ended && clearingPrice !== null) {
        const excess = isThresholdBidder(me) ? thresholdExcess : 0n
        position = { committed, ...settle(committed, excess, clearingPrice), isEstimate: false, claimed: false }
      } else {
        position = { committed, tokens: tokensFor(committed, livePrice), refund: 0n, isEstimate: true, claimed: false }
      }
    }

    const finalEvent = finalLogs.data?.at(-1)?.args

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
      clearingPrice,
      totalSupply: P.totalSupply,
      totalCommitted,
      demandPrice: demand,
      costAtCurrentPrice: costOfSupply(P, currentPrice),
      tokensSold: finalized ? (finalEvent?.sold ?? null) : null,
      tokensBurned: finalized ? (finalEvent?.burned ?? null) : null,
      bids,
      account: me ? { address: me, balance: wallet.balance ?? 0n } : null,
      position,
    }
  }, [reads.data, chainNow, bidLogs.data, myClaims.data, finalLogs.data, me, wallet.balance])

  // ---- Writes -------------------------------------------------------------------
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
        // Dry run: surfaces the contract's error before MetaMask opens.
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
