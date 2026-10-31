import type { AuctionActions, TxState } from '../types'

/** Shown before the owner has called start(). */
export function StartPanel({ actions, tx, loading }: { actions: AuctionActions; tx: TxState; loading: boolean }) {
  const pending = tx.status === 'pending' && tx.action === 'start'
  const message = tx.status !== 'idle' && tx.action === 'start' ? tx : null

  if (loading) {
    return (
      <div className="finalize">
        <p className="finalize__text">Reading the auction from the blockchain…</p>
      </div>
    )
  }

  return (
    <div className="finalize">
      <h2 className="finalize__title">Waiting for the owner to start</h2>
      <p className="finalize__text">
        Bidding opens when the contract owner starts the 20-minute timer. If you deployed the contract, start it here.
      </p>
      {actions.start && (
        <button className="button button--ghost button--wide" onClick={actions.start} disabled={pending}>
          {pending ? tx.message : 'Start auction (owner only)'}
        </button>
      )}
      <p className={`tx-message${message ? ` tx-message--${message.status}` : ''}`} role="status" aria-live="polite">
        {message && message.status !== 'pending' ? message.message : ''}
      </p>
    </div>
  )
}
