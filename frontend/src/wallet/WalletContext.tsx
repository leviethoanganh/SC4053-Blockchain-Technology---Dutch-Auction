import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useBalance, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from 'wagmi'
import { TARGET_CHAIN } from '../config'

/**
 * One shared wallet state for the whole app, so the header button, the
 * "Connect wallet to bid" button and the error banner always agree.
 */
export interface Wallet {
  address: `0x${string}` | undefined
  isConnected: boolean
  isConnecting: boolean
  /** Connected, but MetaMask is on a different network than TARGET_CHAIN. */
  wrongNetwork: boolean
  isSwitching: boolean
  /** ETH balance on TARGET_CHAIN, in wei. undefined while loading. */
  balance: bigint | undefined
  error: string | null
  connect: () => void
  disconnect: () => void
  switchNetwork: () => void
  clearError: () => void
}

const WalletContext = createContext<Wallet | null>(null)

/** Turn wagmi/MetaMask errors into a sentence a user can act on. */
function describeError(error: Error | null): string | null {
  if (!error) return null
  const name = error.name
  const text = `${error.message} ${(error as { shortMessage?: string }).shortMessage ?? ''}`
  if (name === 'UserRejectedRequestError' || /user rejected|user denied/i.test(text)) {
    return 'You closed the MetaMask request. Try again when you are ready.'
  }
  if (name === 'ProviderNotFoundError' || /provider not found/i.test(text)) {
    return 'MetaMask was not found. Install it from metamask.io, then reload this page.'
  }
  if (name === 'ResourceUnavailableRpcError' || /already pending/i.test(text)) {
    return 'MetaMask already has a request open. Open the MetaMask extension to finish it.'
  }
  if (name === 'SwitchChainNotSupportedError' || /unrecognized chain/i.test(text)) {
    return `MetaMask could not switch networks. Choose ${TARGET_CHAIN.name} in MetaMask yourself.`
  }
  return (error as { shortMessage?: string }).shortMessage ?? error.message
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, chainId, status } = useConnection()
  const connectors = useConnectors()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const switchChain = useSwitchChain()
  const balance = useBalance({
    address,
    chainId: TARGET_CHAIN.id,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  })

  // Prefer MetaMask when it announces itself (EIP-6963), else any injected wallet.
  const connector = connectors.find((c) => c.id === 'io.metamask') ?? connectors.find((c) => c.type === 'injected') ?? connectors[0]

  const value = useMemo<Wallet>(
    () => ({
      address,
      isConnected,
      isConnecting: connect.isPending || status === 'connecting' || status === 'reconnecting',
      wrongNetwork: isConnected && chainId !== TARGET_CHAIN.id,
      isSwitching: switchChain.isPending,
      balance: balance.data?.value,
      error: describeError(connect.error ?? switchChain.error ?? null),
      connect: () => {
        switchChain.reset()
        if (connector) connect.mutate({ connector })
      },
      disconnect: () => disconnect.mutate(),
      switchNetwork: () => {
        connect.reset()
        switchChain.mutate({ chainId: TARGET_CHAIN.id })
      },
      clearError: () => {
        connect.reset()
        switchChain.reset()
      },
    }),
    [address, isConnected, chainId, status, connector, connect, disconnect, switchChain, balance.data?.value],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext)
  if (!wallet) throw new Error('useWallet must be used inside <WalletProvider>')
  return wallet
}
