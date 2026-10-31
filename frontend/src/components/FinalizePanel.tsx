import { TOKEN } from '../config'
import { formatUnits } from '../lib/format'
import type { AuctionActions, AuctionView, TxState } from '../types'

/** Shown instead of the bid form once bidding has closed. */
export function FinalizePanel({ view, actions, tx }: { view: AuctionView; actions: AuctionActions; tx: TxState }) {
  const pending = tx.status === 'pending' && tx.action === 'finalize'
  const message = tx.status !== 'idle' && tx.action === 'finalize' ? tx : null

  if (view.finalized) {
    return (
      <div className="finalize finalize--done">
        <h2 className="finalize__title">Auction finalized</h2>
        <dl className="facts">
          <div>
            <dt>Sold</dt>
            <dd>
              {formatUnits(view.tokensSold ?? 0n, 2)} {TOKEN.symbol}
            </dd>
          </div>
          <div>
            <dt>Burned</dt>
            <dd>
              {formatUnits(view.tokensBurned ?? 0n, 2)} {TOKEN.symbol}
            </dd>
          </div>
        </dl>
        <p className="finalize__text">Bidders can now claim their tokens and refunds below.</p>
      </div>
    )
  }

  return (
    <div className="finalize">
      <h2 className="finalize__title">Bidding is closed</h2>
      <p className="finalize__text">
        Anyone can finalize the auction. This locks in the price and burns any unsold tokens, then claims open.
      </p>
      <button className="button button--primary button--wide" onClick={actions.finalize} disabled={pending}>
        {pending ? 'Finalizing…' : 'Finalize auction'}
      </button>
      <p className={`tx-message${message ? ` tx-message--${message.status}` : ''}`} role="status" aria-live="polite">
        {message?.message}
      </p>
    </div>
  )
}
