import type { UseAuctionResult } from '../types'
import { useMockAuction } from './useMockAuction'

/**
 * The one place the UI gets auction data from.
 *
 * Today it returns a browser simulation. When DutchAuction.sol is deployed,
 * write `useChainAuction()` with wagmi + viem that returns the same
 * `UseAuctionResult` shape, and switch it here. No component needs to change.
 */
export function useAuction(): UseAuctionResult {
  return useMockAuction()
}
