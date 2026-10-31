import { parseAbi, type Address } from 'viem'

/**
 * The DutchAuction contract, as the frontend sees it.
 *
 * This ABI is written from the interface agreed in the README. Once the
 * contracts are built (`forge build`), replace it with the real ABI from
 * contracts/out/DutchAuction.sol/DutchAuction.json so names always match, and
 * so custom errors show up with their names in the UI.
 */
export const auctionAbi = parseAbi([
  'function start()',
  'function bid() payable',
  'function finalize()',
  'function claim()',
  'function currentPrice() view returns (uint256)',
  'function startTime() view returns (uint256)',
  'function endTime() view returns (uint256)',
  'function clearingPrice() view returns (uint256)',
  'function totalCommitted() view returns (uint256)',
  'function commitments(address) view returns (uint256)',
  'function finalized() view returns (bool)',
  'event BidPlaced(address indexed bidder, uint256 amount, uint256 price)',
  'event AuctionFinalized(uint256 clearingPrice, uint256 sold, uint256 burned)',
  'event Claimed(address indexed bidder, uint256 tokens, uint256 refund)',
])

const rawAddress = import.meta.env.VITE_AUCTION_ADDRESS?.trim()

/** Deployed DutchAuction address, from VITE_AUCTION_ADDRESS. undefined = preview mode. */
export const AUCTION_ADDRESS: Address | undefined = rawAddress && /^0x[0-9a-fA-F]{40}$/.test(rawAddress) ? (rawAddress as Address) : undefined

/**
 * Block the contract was deployed in, from VITE_AUCTION_DEPLOY_BLOCK.
 * Event searches start here. On Sepolia, public RPCs refuse to search from
 * block 0, so set this to the block number shown on Etherscan for the deploy.
 */
export const AUCTION_DEPLOY_BLOCK = BigInt(import.meta.env.VITE_AUCTION_DEPLOY_BLOCK?.trim() || '0')

export const auction = { address: AUCTION_ADDRESS!, abi: auctionAbi } as const
