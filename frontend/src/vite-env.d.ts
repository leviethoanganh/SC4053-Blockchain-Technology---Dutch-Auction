/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "sepolia" (default) or "anvil" for a local node */
  readonly VITE_CHAIN?: string
  /** Optional Sepolia RPC URL (Alchemy, Infura...). Falls back to a public RPC. */
  readonly VITE_SEPOLIA_RPC_URL?: string
  /** Deployed DutchAuction address. Unset = preview mode with simulated data. */
  readonly VITE_AUCTION_ADDRESS?: string
  /** Block number the auction was deployed in (needed on Sepolia for the bid list). */
  readonly VITE_AUCTION_DEPLOY_BLOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
