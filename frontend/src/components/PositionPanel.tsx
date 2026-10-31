import { TOKEN } from '../config'
import { formatUnits } from '../lib/format'
import type { AuctionActions, AuctionView, TxState } from '../types'

export function PositionPanel({ view, actions, tx }: { view: AuctionView; actions: AuctionActions; tx: TxState }) {
  const pos = view.position
  const pending = tx.status === 'pending' && tx.action === 'claim'
  // Once claimed, the note below already says so; only surface errors or progress.
  const message =
    tx.status !== 'idle' && tx.action === 'claim' && !(tx.status === 'success' && pos?.claimed) ? tx : null

  return (
    <section className="panel" aria-labelledby="position-title">
      <h2 id="position-title" className="panel__title">
        Your position
      </h2>

      {!pos ? (
        <div className="empty">
          <p>Connect your wallet to see your bids, tokens and refund.</p>
          <button className="button button--ghost" onClick={actions.connect}>
            Connect wallet
          </button>
        </div>
      ) : pos.committed === 0n ? (
        <p className="empty">
          {view.phase === 'live' ? 'You have not bid yet. Your bids will show here.' : 'You did not bid in this auction.'}
        </p>
      ) : (
        <>
          <dl className="facts">
            <div>
              <dt>ETH committed</dt>
              <dd>{formatUnits(pos.committed, 4)} ETH</dd>
            </div>
            <div>
              <dt>{pos.isEstimate ? 'Tokens, at least' : 'Tokens'}</dt>
              <dd>
                {formatUnits(pos.tokens, 2)} {TOKEN.symbol}
              </dd>
            </div>
            <div>
              <dt>Refund</dt>
              <dd>{pos.isEstimate ? 'Known when the auction ends' : `${formatUnits(pos.refund, 6)} ETH`}</dd>
            </div>
          </dl>

          {pos.claimed ? (
            <p className="panel__note panel__note--good">Claimed. The tokens and refund are in your wallet.</p>
          ) : view.finalized ? (
            <button className="button button--primary" onClick={actions.claim} disabled={pending}>
              {pending ? 'Waiting for wallet…' : 'Claim tokens and refund'}
            </button>
          ) : (
            <p className="panel__note">
              {pos.isEstimate
                ? 'If the price keeps falling before the auction ends, your ETH buys more tokens.'
                : 'Claims open once someone finalizes the auction.'}
            </p>
          )}
          <p className={`tx-message${message ? ` tx-message--${message.status}` : ''}`} role="status" aria-live="polite">
            {message?.message}
          </p>
        </>
      )}
    </section>
  )
}
