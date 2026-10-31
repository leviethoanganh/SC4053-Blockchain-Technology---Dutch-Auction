import { NETWORK_NAME, TOKEN } from '../config'
import { useWallet } from '../wallet/WalletContext'
import { WalletButton } from './WalletButton'

export function TulipMark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 30V17" className="mark__stem" />
      <path d="M16 24c-3-4-7-4-9-3 2 3 5 4 9 3z" className="mark__leaf" />
      <path d="M8 5l4 4 4-6 4 6 4-4v7a8 8 0 0 1-16 0z" className="mark__bloom" />
    </svg>
  )
}

export function Header() {
  const w = useWallet()
  const dot = !w.isConnected ? 'idle' : w.wrongNetwork ? 'warn' : 'ok'
  const dotTitle = !w.isConnected ? 'Wallet not connected' : w.wrongNetwork ? 'MetaMask is on another network' : `Connected to ${NETWORK_NAME}`

  return (
    <header className="header">
      <div className="header__brand">
        <TulipMark />
        <span className="header__name">
          {TOKEN.name} auction <span className="header__symbol">{TOKEN.symbol}</span>
        </span>
      </div>
      <div className="header__wallet">
        <span className="pill" title={dotTitle}>
          <span className={`pill__dot pill__dot--${dot}`} aria-hidden="true" />
          {NETWORK_NAME}
        </span>
        <WalletButton />
      </div>
    </header>
  )
}
