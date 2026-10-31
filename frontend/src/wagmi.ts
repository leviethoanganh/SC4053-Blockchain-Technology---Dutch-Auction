import { createConfig, http } from 'wagmi'
import { foundry, sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

/**
 * Networks the dApp can talk to:
 * - Sepolia: the public testnet we demo on
 * - foundry: a local Anvil node (`anvil`) for development, chain id 31337
 *
 * Sepolia uses viem's default public RPC. If it is slow or rate-limited, put
 * an Alchemy/Infura URL in VITE_SEPOLIA_RPC_URL (frontend/.env.local).
 */
export const wagmiConfig = createConfig({
  chains: [sepolia, foundry],
  connectors: [injected()], // the wallet extension in the browser, i.e. MetaMask
  pollingInterval: 2_000, // how often to check for new blocks and receipts (default 4s)
  transports: {
    [sepolia.id]: http(import.meta.env.VITE_SEPOLIA_RPC_URL || undefined),
    [foundry.id]: http('http://127.0.0.1:8545'),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
