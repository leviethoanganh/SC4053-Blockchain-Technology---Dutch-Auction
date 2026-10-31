import { TOKEN } from '../config'
import { formatPrice, formatUnits } from '../lib/format'
import type { AuctionView } from '../types'

export function StatusHeading({ view }: { view: AuctionView }) {
  const range = `Started at ${formatUnits(view.startPrice, 6)} ETH and stops falling at ${formatUnits(view.reservePrice, 6)} ETH.`
  const supply = `${formatUnits(view.totalSupply, 0)} ${TOKEN.symbol}`

  switch (view.phase) {
    case 'not-started':
      return (
        <div className="status">
          <h1 className="status__title">The auction has not started yet</h1>
          <p className="status__text">
            {supply} go on sale at {formatUnits(view.startPrice, 6)} ETH each. The price then falls for 20 minutes.
          </p>
        </div>
      )
    case 'live':
      return (
        <div className="status">
          <h1 className="status__title">The price drops every second</h1>
          <p className="status__text">
            Bid any time. Everyone pays the same final price, so bidding early never costs you more. {range}
          </p>
        </div>
      )
    case 'cleared':
      return (
        <div className="status">
          <h1 className="status__title">Sold out at {formatPrice(view.clearingPrice ?? 0n)} ETH</h1>
          <p className="status__text">Bids covered all {supply}, so the auction ended early. Every bidder pays this price.</p>
        </div>
      )
    case 'time-up':
      return (
        <div className="status">
          <h1 className="status__title">Time is up at {formatPrice(view.reservePrice)} ETH</h1>
          <p className="status__text">
            The auction ended at the reserve price without selling out. Unsold tokens are burned when it is finalized.
          </p>
        </div>
      )
  }
}
