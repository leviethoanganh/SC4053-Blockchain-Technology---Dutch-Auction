import { WAD, parseEth } from './lib/format'
import type { AuctionParams } from './lib/auction'

/**
 * Auction settings. These MUST match the values the DutchAuction contract is
 * deployed with. Once the contract exists, read them from the chain instead.
 */
export const TOKEN = {
  name: 'Tulip',
  symbol: 'TLP',
}

export const NETWORK_NAME = 'Sepolia'

export const AUCTION_PARAMS: AuctionParams = {
  totalSupply: 1_000n * WAD, // 1,000 TLP (18 decimals)
  startPrice: parseEth('0.001'), // wei per whole TLP
  reservePrice: parseEth('0.0001'), // wei per whole TLP
  durationSec: 20 * 60, // exactly 20 minutes
}
