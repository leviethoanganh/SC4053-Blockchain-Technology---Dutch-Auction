import type { AuctionView } from '../types'
import { formatClock, formatPrice } from '../lib/format'

/**
 * The price clock, after the clocks used in Dutch flower auctions: a light runs
 * around the dial as the price falls. Because the price falls linearly, each
 * position on the dial is both a moment in time and a price.
 */

const SIZE = 400
const C = SIZE / 2
const R = 150
const START_DEG = -150
const SWEEP = 300
const TICKS = 60 // one every 20 seconds of a 20-minute auction

function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180
  return [C + r * Math.cos(rad), C + r * Math.sin(rad)]
}

function fractionForPrice(view: AuctionView, price: bigint): number {
  const range = view.startPrice - view.reservePrice
  if (range <= 0n) return 0
  const f = Number(((view.startPrice - price) * 10_000n) / range) / 10_000
  return Math.min(1, Math.max(0, f))
}

const MINUTE_LABELS = [0, 5, 10, 15, 20]

export function PriceClock({ view }: { view: AuctionView }) {
  const ended = view.phase === 'cleared' || view.phase === 'time-up'
  const f = fractionForPrice(view, view.currentPrice)
  const lampDeg = START_DEG + f * SWEEP

  const showDemand =
    view.phase === 'live' && view.totalCommitted > 0n && view.demandPrice >= view.reservePrice && view.demandPrice < view.currentPrice
  const demandDeg = START_DEG + fractionForPrice(view, view.demandPrice) * SWEEP

  const totalMin = view.durationSec / 60
  const centerLabel = view.phase === 'not-started' ? 'Start price' : ended ? 'Clearing price' : 'Current price'

  return (
    <figure className="clock">
      <svg
        className="clock__dial"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${centerLabel} ${formatPrice(view.currentPrice)} ETH per token, ${formatClock(view.remainingSec)} left`}
      >
        <circle className="clock__face" cx={C} cy={C} r={R + 34} />

        {Array.from({ length: TICKS + 1 }, (_, i) => {
          const deg = START_DEG + (i / TICKS) * SWEEP
          const major = i % 3 === 0
          const passed = i / TICKS < f - 1e-9
          const [x1, y1] = polar(R - (major ? 14 : 8), deg)
          const [x2, y2] = polar(R, deg)
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={`clock__tick${major ? ' clock__tick--major' : ''}${passed ? ' clock__tick--passed' : ''}`}
            />
          )
        })}

        {MINUTE_LABELS.map((m) => {
          const [x, y] = polar(R + 20, START_DEG + (m / totalMin) * SWEEP)
          return (
            <text key={m} x={x} y={y + 4} className="clock__minute" textAnchor="middle">
              {m === 0 ? '0 min' : m}
            </text>
          )
        })}

        {showDemand && (
          <g transform={`rotate(${demandDeg} ${C} ${C})`} className="clock__demand">
            <path d={`M${C} ${C - R + 22} l-7 12 h14 z`} />
          </g>
        )}

        <g className="clock__lamp" style={{ transform: `rotate(${lampDeg}deg)` }}>
          <circle cx={C} cy={C - R} r={16} className="clock__lamp-glow" />
          <circle cx={C} cy={C - R} r={7} className="clock__lamp-core" />
        </g>
      </svg>

      <div className="clock__readout" aria-hidden="true">
        <span className="clock__label">{centerLabel}</span>
        <span className="clock__price">{formatPrice(view.currentPrice)}</span>
        <span className="clock__unit">ETH per token</span>
        <span className="clock__time">{ended ? 'Ended' : `${formatClock(view.remainingSec)} left`}</span>
      </div>

      {showDemand && (
        <figcaption className="clock__legend">
          <svg viewBox="0 0 14 12" width="14" height="12" aria-hidden="true">
            <path d="M7 0 L14 12 H0 Z" />
          </svg>
          Sells out here if no one else bids: {formatPrice(view.demandPrice)} ETH
        </figcaption>
      )}
    </figure>
  )
}
