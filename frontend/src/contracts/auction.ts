import type { Address } from 'viem'
import { dutchAuctionAbi } from './DutchAuction.abi'

/**
 * The deployed DutchAuction contract.
 *
 * The ABI is generated from the Foundry build (contracts/out) by `npm run sync-abi`,
 * so function, event and error names always match the Solidity code.
 */
export const auctionAbi = dutchAuctionAbi

const rawAddress = import.meta.env.VITE_AUCTION_ADDRESS?.trim()

/** Deployed DutchAuction address, from VITE_AUCTION_ADDRESS. undefined = preview mode. */
export const AUCTION_ADDRESS: Address | undefined = rawAddress && /^0x[0-9a-fA-F]{40}$/.test(rawAddress) ? (rawAddress as Address) : undefined

/**
 * Block the contract was deployed in, from VITE_AUCTION_DEPLOY_BLOCK.
 * Event searches start here. On Sepolia, public RPCs refuse to search from
 * block 0, so set this to the block number printed by the deploy script.
 */
export const AUCTION_DEPLOY_BLOCK = BigInt(import.meta.env.VITE_AUCTION_DEPLOY_BLOCK?.trim() || '0')

export const auction = { address: AUCTION_ADDRESS!, abi: auctionAbi } as const
