import { NETWORK_NAME } from '../config'
import { useWallet } from '../wallet/WalletContext'

/** Strip under the header for wallet problems: wrong network, or a failed request. */
export function WalletNotice() {
  const w = useWallet()

  if (w.wrongNetwork) {
    return (
      <div className="notice" role="alert">
        <p className="notice__text">MetaMask is on a different network. This auction runs on {NETWORK_NAME}.</p>
        <button className="button button--primary" onClick={w.switchNetwork} disabled={w.isSwitching}>
          {w.isSwitching ? 'Check MetaMask…' : `Switch to ${NETWORK_NAME}`}
        </button>
      </div>
    )
  }

  if (w.error) {
    return (
      <div className="notice notice--error" role="alert">
        <p className="notice__text">{w.error}</p>
        <button className="button button--ghost" onClick={w.clearError}>
          Dismiss
        </button>
      </div>
    )
  }

  return null
}
