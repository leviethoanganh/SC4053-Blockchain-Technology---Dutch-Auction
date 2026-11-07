import { useId, useState, type FormEvent } from 'react'
import { TOKEN } from '../config'
import { tokensFor } from '../lib/auction'
import { formatUnits, parseEth } from '../lib/format'
import type { AuctionActions, AuctionView, TxState } from '../types'

const QUICK_AMOUNTS = ['0.0001', '0.0005', '0.001']

export function BidForm({ view, actions, tx }: { view: AuctionView; actions: AuctionActions; tx: TxState }) {
  const [amount, setAmount] = useState('')
  const inputId = useId()
  const hintId = useId()

  let parsed: bigint | null = null
  let inputError: string | null = null
  if (amount.trim() !== '') {
    try {
      parsed = parseEth(amount)
    } catch (e) {
      inputError = (e as Error).message
    }
  }

  const pending = tx.status === 'pending' && tx.action === 'bid'
  const tooMuch = parsed !== null && view.account !== null && parsed > view.account.balance
  const canSubmit = view.account !== null && parsed !== null && parsed > 0n && !tooMuch && !pending

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!view.account) return actions.connect()
    if (parsed === null) return
    if (await actions.bid(parsed)) setAmount('')
  }

  const minTokens = parsed && parsed > 0n ? tokensFor(parsed, view.currentPrice) : null
  const message = tx.status !== 'idle' && tx.action === 'bid' ? tx : null

  return (
    <form className="bid" onSubmit={onSubmit} noValidate>
      <div className="bid__top">
        <label htmlFor={inputId} className="bid__label">
          Your bid
        </label>
        {view.account && (
          <span className="bid__balance">
            {view.mode === 'preview' ? 'Preview balance' : 'Balance'} {formatUnits(view.account.balance, 4)} ETH
          </span>
        )}
      </div>
      <div className={`bid__field${inputError || tooMuch ? ' bid__field--error' : ''}`}>
        <input
          id={inputId}
          className="bid__input"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
          aria-describedby={hintId}
          aria-invalid={Boolean(inputError || tooMuch)}
          disabled={pending}
        />
        <span className="bid__suffix">ETH</span>
      </div>
      <div className="bid__quick" role="group" aria-label="Quick amounts">
        {QUICK_AMOUNTS.map((q) => (
          <button key={q} type="button" className="chip" onClick={() => setAmount(q)} disabled={pending}>
            {q} ETH
          </button>
        ))}
      </div>

      <p id={hintId} className="bid__hint">
        {inputError ??
          (tooMuch
            ? 'That is more ETH than your wallet holds.'
            : minTokens !== null
              ? `You get at least ${formatUnits(minTokens, 2)} ${TOKEN.symbol}. If the final price is lower, the same ETH buys more, and anything left over is refunded.`
              : 'Enter how much ETH to commit. Unused ETH is refunded when you claim.')}
      </p>

      <button type="submit" className="button button--primary button--wide" disabled={view.account !== null && !canSubmit}>
        {pending ? 'Waiting for wallet…' : view.account ? 'Place bid' : 'Connect wallet to bid'}
      </button>

      <p className={`tx-message${message ? ` tx-message--${message.status}` : ''}`} role="status" aria-live="polite">
        {message?.message}
      </p>
    </form>
  )
}
