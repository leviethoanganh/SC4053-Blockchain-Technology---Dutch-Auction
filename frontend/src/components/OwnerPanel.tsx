import { formatUnits } from '../lib/format'
import type { AuctionActions, AuctionView, TxState } from '../types'

/** Shown only to the contract owner once the auction is finalized: withdraw the sale proceeds. */
export function OwnerPanel({ view, actions, tx }: { view: AuctionView; actions: AuctionActions; tx: TxState }) {
  const pending = tx.status === 'pending' && tx.action === 'withdraw'
  const message = tx.status !== 'idle' && tx.action === 'withdraw' ? tx : null
  const owner = view.owner

  if (!owner || !view.finalized || !actions.withdrawProceeds) return null

  return (
    <div className="finalize">
      <h2 className="finalize__title">Owner: sale proceeds</h2>
      <dl className="facts">
        <div>
          <dt>Ready to withdraw</dt>
          <dd>{formatUnits(owner.proceeds, 6)} ETH</dd>
        </div>
        <div>
          <dt>Withdrawn so far</dt>
          <dd>{formatUnits(owner.withdrawn, 6)} ETH</dd>
        </div>
      </dl>
      <p className="finalize__text">
        Proceeds build up as bidders claim. Refunds stay in the contract for bidders, so only claimed sales can be
        withdrawn.
      </p>
      <button
        className="button button--primary button--wide"
        onClick={actions.withdrawProceeds}
        disabled={pending || owner.proceeds === 0n}
      >
        {pending ? tx.message : owner.proceeds === 0n ? 'Nothing to withdraw yet' : 'Withdraw proceeds'}
      </button>
      <p className={`tx-message${message ? ` tx-message--${message.status}` : ''}`} role="status" aria-live="polite">
        {message && message.status !== 'pending' ? message.message : ''}
      </p>
    </div>
  )
}
