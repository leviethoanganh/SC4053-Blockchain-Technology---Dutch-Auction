import { foundry, sepolia } from 'wagmi/chains'
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

/** The network MetaMask must be on. Set VITE_CHAIN=anvil in .env.local for local testing. */
export const TARGET_CHAIN = import.meta.env.VITE_CHAIN === 'anvil' ? foundry : sepolia

export const NETWORK_NAME = TARGET_CHAIN.id === foundry.id ? 'Local Anvil' : 'Sepolia'

export const AUCTION_PARAMS: AuctionParams = {
  totalSupply: 1_000n * WAD, // 1,000 TLP (18 decimals)
  startPrice: parseEth('0.00001'), // wei per whole TLP
  reservePrice: parseEth('0.000001'), // wei per whole TLP
  durationSec: 20 * 60, // exactly 20 minutes
}
