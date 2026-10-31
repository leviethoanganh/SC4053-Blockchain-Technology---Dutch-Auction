import type { Phase } from './lib/auction'

export type { Phase }

export interface FeedBid {
  id: string
  bidder: string
  amount: bigint
  price: bigint
  at: number
  isMine: boolean
  isThreshold: boolean
}

export interface Position {
  committed: bigint
  tokens: bigint
  refund: bigint
  /** true while the auction is live: tokens are a minimum, refund unknown */
  isEstimate: boolean
  claimed: boolean
}

export interface Account {
  address: string
  balance: bigint
}

/** Everything the UI needs to draw the auction. Same shape for mock and real chain. */
export interface AuctionView {
  mode: 'preview' | 'chain'
  phase: Phase
  finalized: boolean
  elapsedSec: number
  remainingSec: number
  durationSec: number
  startPrice: bigint
  reservePrice: bigint
  /** Live price while running, clearing price once ended. */
  currentPrice: bigint
  clearingPrice: bigint | null
  totalSupply: bigint
  totalCommitted: bigint
  /** Price at which today's demand buys the whole supply. */
  demandPrice: bigint
  /** ETH needed to buy the whole supply at the current price. */
  costAtCurrentPrice: bigint
  tokensSold: bigint | null
  tokensBurned: bigint | null
  bids: FeedBid[]
  account: Account | null
  position: Position | null
}

export type TxAction = 'connect' | 'bid' | 'finalize' | 'claim'

export type TxState =
  | { status: 'idle' }
  | { status: 'pending'; action: TxAction; message: string }
  | { status: 'success'; action: TxAction; message: string }
  | { status: 'error'; action: TxAction; message: string }

export interface AuctionActions {
  connect: () => void
  disconnect: () => void
  /** Resolves true once the bid is confirmed, false if it was rejected. */
  bid: (amountWei: bigint) => Promise<boolean>
  finalize: () => Promise<void>
  claim: () => Promise<void>
}

export interface DemoControls {
  skip: (seconds: number) => void
  restart: () => void
}

export interface UseAuctionResult {
  view: AuctionView
  actions: AuctionActions
  tx: TxState
  /** Only present in preview mode. */
  demo?: DemoControls
}
