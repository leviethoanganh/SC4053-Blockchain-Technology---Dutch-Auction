import { TOKEN } from '../config'
import { formatPrice, formatUnits, percent } from '../lib/format'
import type { AuctionView } from '../types'

/** How close total bids are to buying the whole supply at the current price. */
export function DemandBar({ view }: { view: AuctionView }) {
  const share = Math.min(100, percent(view.totalCommitted, view.costAtCurrentPrice))
  const ended = view.phase === 'cleared' || view.phase === 'time-up'

  let caption: string
  if (view.phase === 'cleared') {
    caption = `${formatUnits(view.totalCommitted, 4)} ETH in bids bought all ${formatUnits(view.totalSupply, 0)} ${TOKEN.symbol}.`
  } else if (view.phase === 'time-up') {
    caption = `${formatUnits(view.totalCommitted, 4)} ETH in bids. The rest of the supply was not sold.`
  } else if (view.totalCommitted === 0n) {
    caption = 'No bids yet.'
  } else if (view.demandPrice < view.reservePrice) {
    caption = 'At today’s demand, the price will reach its floor before the supply sells out.'
  } else {
    caption = `At today’s demand, the auction sells out when the price reaches ${formatPrice(view.demandPrice)} ETH.`
  }

  return (
    <section className="demand" aria-labelledby="demand-title">
      <div className="demand__row">
        <h2 id="demand-title" className="demand__title">
          {ended ? 'Bids received' : 'Bids so far'}
        </h2>
        <span className="demand__figures">
          <strong>{formatUnits(view.totalCommitted, 4)}</strong> of {formatUnits(view.costAtCurrentPrice, 4)} ETH
        </span>
      </div>
      <div
        className="demand__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share)}
        aria-label="Share of supply covered by bids at the current price"
      >
        <div className="demand__fill" style={{ width: `${share}%` }} />
      </div>
      <p className="demand__caption">
        {!ended && <span>{Math.floor(share)}% of the supply is covered at this price. </span>}
        {caption}
      </p>
    </section>
  )
}
