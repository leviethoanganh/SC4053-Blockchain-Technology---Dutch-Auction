import { NETWORK_NAME, TOKEN } from '../config'
import { formatUnits, shortAddress } from '../lib/format'
import type { AuctionActions, AuctionView } from '../types'

export function TulipMark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 30V17" className="mark__stem" />
      <path d="M16 24c-3-4-7-4-9-3 2 3 5 4 9 3z" className="mark__leaf" />
      <path d="M8 5l4 4 4-6 4 6 4-4v7a8 8 0 0 1-16 0z" className="mark__bloom" />
    </svg>
  )
}

export function Header({ view, actions }: { view: AuctionView; actions: AuctionActions }) {
  return (
    <header className="header">
      <div className="header__brand">
        <TulipMark />
        <span className="header__name">
          {TOKEN.name} auction <span className="header__symbol">{TOKEN.symbol}</span>
        </span>
      </div>
      <div className="header__wallet">
        <span className="pill" title="Network the contract runs on">
          <span className="pill__dot" aria-hidden="true" />
          {NETWORK_NAME}
        </span>
        {view.account ? (
          <button className="account" onClick={actions.disconnect} title="Disconnect wallet">
            <span className="account__balance">{formatUnits(view.account.balance, 4)} ETH</span>
            <span className="account__address">{shortAddress(view.account.address)}</span>
          </button>
        ) : (
          <button className="button button--primary" onClick={actions.connect}>
            Connect wallet
          </button>
        )}
      </div>
    </header>
  )
}
