import { AUCTION_ADDRESS } from '../contracts/auction'
import type { UseAuctionResult } from '../types'
import { useChainAuction } from './useChainAuction'
import { useMockAuction } from './useMockAuction'

/** true when VITE_AUCTION_ADDRESS is set (frontend/.env.local), so the page uses the real contract. */
export const USING_CONTRACT = AUCTION_ADDRESS !== undefined

/**
 * The one place the UI gets auction data from.
 *
 * - VITE_AUCTION_ADDRESS set   → live data from the deployed DutchAuction contract
 * - VITE_AUCTION_ADDRESS unset → preview mode, simulated in the browser
 *
 * The choice is fixed when the app starts, so React always calls the same hook.
 */
export const useAuction: () => UseAuctionResult = USING_CONTRACT ? useChainAuction : useMockAuction
