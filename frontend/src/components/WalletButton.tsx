import { formatUnits, shortAddress } from '../lib/format'
import { useWallet } from '../wallet/WalletContext'

/** Header button: "Connect wallet", or the connected account with its real ETH balance. */
export function WalletButton() {
  const w = useWallet()

  if (!w.isConnected || !w.address) {
    return (
      <button className="button button--primary" onClick={w.connect} disabled={w.isConnecting}>
        {w.isConnecting ? 'Check MetaMask…' : 'Connect wallet'}
      </button>
    )
  }

  return (
    <button className="account" onClick={w.disconnect} title="Disconnect wallet">
      <span className="account__balance">{w.balance === undefined ? '…' : formatUnits(w.balance, 4)} ETH</span>
      <span className="account__address">{shortAddress(w.address)}</span>
    </button>
  )
}
