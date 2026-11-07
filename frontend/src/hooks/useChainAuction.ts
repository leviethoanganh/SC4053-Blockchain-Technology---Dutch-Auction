import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { zeroAddress, type ContractEventName, type GetContractEventsReturnType } from 'viem'
import { useBlock, usePublicClient, useReadContracts, useWriteContract } from 'wagmi'
import { AUCTION_PARAMS, NETWORK_NAME, TARGET_CHAIN } from '../config'
import { AUCTION_DEPLOY_BLOCK, auction, auctionAbi } from '../contracts/auction'
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

type FunctionName = 'start' | 'bid' | 'finalize' | 'claim' | 'withdrawProceeds'

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
      { ...auction, chainId, functionName: 'owner' },
      { ...auction, chainId, functionName: 'proceeds' },
    ],
  })
  const { refetch: refetchReads } = reads
  useEffect(() => {
    if (block?.number !== undefined) void refetchReads()
  }, [block?.number, refetchReads])

  // ---- Event logs ---------------------------------------------------------------
  const { logs: eventLogs, error: logsError, sync: syncLogs } = useAuctionLogs(client, block?.number)
  const bidLogs = useMemo(() => eventLogs.filter(isEvent('BidPlaced')), [eventLogs])
  const myClaims = useMemo(
    () => (me ? eventLogs.filter(isEvent('Claimed')).filter((l) => l.args.bidder!.toLowerCase() === me.toLowerCase()) : []),
    [eventLogs, me],
  )
  const finalLogs = useMemo(() => eventLogs.filter(isEvent('AuctionFinalized')), [eventLogs])
  const withdrawLogs = useMemo(() => eventLogs.filter(isEvent('ProceedsWithdrawn')), [eventLogs])

  const ownerAddress = reads.data?.[11]
  const isOwner = me !== undefined && ownerAddress !== undefined && me.toLowerCase() === ownerAddress.toLowerCase()

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
    const logs = bidLogs
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
      const claimLog = myClaims.at(-1)?.args
      if (claimLog) {
        position = { committed, tokens: claimLog.tokens!, refund: claimLog.refund!, isEstimate: false, claimed: true }
      } else if (ended && clearingPrice !== null) {
        const excess = isThresholdBidder(me) ? thresholdExcess : 0n
        position = { committed, ...settle(committed, excess, clearingPrice), isEstimate: false, claimed: false }
      } else {
        position = { committed, tokens: tokensFor(committed, livePrice), refund: 0n, isEstimate: true, claimed: false }
      }
    }

    const finalEvent = finalLogs.at(-1)?.args
    const owner = isOwner
      ? { proceeds: d?.[12] ?? 0n, withdrawn: withdrawLogs.reduce((sum, l) => sum + l.args.amount!, 0n) }
      : null

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
      owner,
    }
  }, [reads.data, chainNow, bidLogs, myClaims, finalLogs, withdrawLogs, isOwner, me, wallet.balance])

  // ---- Writes -------------------------------------------------------------------
  const refreshAll = useCallback(
    (upTo: bigint) => Promise.all([refetchReads(), syncLogs(upTo)]),
    [refetchReads, syncLogs],
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
        await refreshAll(receipt.blockNumber)
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
      withdrawProceeds: async () => {
        await send('withdraw', 'withdrawProceeds', 'Proceeds sent to the owner wallet.')
      },
    }),
    [wallet, send],
  )

  const problem = reads.error
    ? `Can't read the auction contract at ${auction.address} on ${NETWORK_NAME}. Check VITE_AUCTION_ADDRESS, and that the contract is deployed on this network.`
    : logsError
      ? `Can't load the bid history from the RPC (${(logsError as { shortMessage?: string }).shortMessage ?? String(logsError)}). On Sepolia, check VITE_AUCTION_DEPLOY_BLOCK and VITE_SEPOLIA_RPC_URL.`
      : null

  return { view, actions, tx, status: reads.data ? 'ready' : reads.error ? 'error' : 'loading', problem }
}

// ---- Event log sync -------------------------------------------------------------

/**
 * Blocks per eth_getLogs request. Alchemy's free tier refuses ranges over 10 blocks,
 * so the history is fetched in chunks, a few chunks at a time.
 */
const LOG_CHUNK = 10n
const LOG_PARALLEL = 5

type AuctionLog = GetContractEventsReturnType<typeof auctionAbi>[number]

function isEvent<N extends ContractEventName<typeof auctionAbi>>(name: N) {
  return (log: AuctionLog): log is Extract<AuctionLog, { eventName: N }> => log.eventName === name
}

/**
 * Every event the auction contract has emitted, kept up to date incrementally:
 * the first sync backfills from the deploy block, later syncs only fetch new blocks.
 */
function useAuctionLogs(client: ReturnType<typeof usePublicClient>, head: bigint | undefined) {
  const [logs, setLogs] = useState<AuctionLog[]>([])
  const [error, setError] = useState<unknown>(null)
  const nextRef = useRef(AUCTION_DEPLOY_BLOCK) // first block not fetched yet
  const targetRef = useRef(-1n) // highest block asked for
  const busyRef = useRef<Promise<void> | null>(null)

  const sync = useCallback(
    (upTo: bigint): Promise<void> => {
      if (upTo > targetRef.current) targetRef.current = upTo
      if (!client) return Promise.resolve()
      // One sync at a time; a running sync picks up the raised target before it finishes.
      if (busyRef.current) return busyRef.current
      const run = async () => {
        try {
          while (nextRef.current <= targetRef.current) {
            const ranges: [bigint, bigint][] = []
            let from = nextRef.current
            while (from <= targetRef.current && ranges.length < LOG_PARALLEL) {
              const to = from + LOG_CHUNK - 1n < targetRef.current ? from + LOG_CHUNK - 1n : targetRef.current
              ranges.push([from, to])
              from = to + 1n
            }
            const batches = await Promise.all(
              ranges.map(([fromBlock, toBlock]) => client.getContractEvents({ ...auction, fromBlock, toBlock })),
            )
            nextRef.current = from
            const found = batches.flat()
            if (found.length) setLogs((prev) => [...prev, ...found])
          }
          setError(null)
        } catch (e) {
          setError(e) // retried on the next block, from the first missing block
        } finally {
          busyRef.current = null
        }
      }
      busyRef.current = run()
      return busyRef.current
    },
    [client],
  )

  useEffect(() => {
    if (head !== undefined) void sync(head)
  }, [head, sync])

  return { logs, error, sync }
}
