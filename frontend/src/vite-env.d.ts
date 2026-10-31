/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "sepolia" (default) or "anvil" for a local node */
  readonly VITE_CHAIN?: string
  /** Optional Sepolia RPC URL (Alchemy, Infura...). Falls back to a public RPC. */
  readonly VITE_SEPOLIA_RPC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
