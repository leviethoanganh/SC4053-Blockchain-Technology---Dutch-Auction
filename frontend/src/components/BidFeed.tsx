import { formatClock, formatPrice, formatUnits, shortAddress } from '../lib/format'
import type { AuctionView } from '../types'

export function BidFeed({ view }: { view: AuctionView }) {
  return (
    <section className="panel" aria-labelledby="feed-title">
      <h2 id="feed-title" className="panel__title">
        Bids <span className="panel__count">{view.bids.length}</span>
      </h2>
      {view.bids.length === 0 ? (
        <p className="empty">No bids yet. The first bid shows up here.</p>
      ) : (
        <div className="feed__scroll">
          <table className="feed">
            <thead>
              <tr>
                <th scope="col">Bidder</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col" className="num">
                  Price then
                </th>
                <th scope="col" className="num">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {view.bids.map((b) => (
                <tr key={b.id} className={b.isMine ? 'feed__mine' : undefined}>
                  <td>
                    <span className="feed__bidder">{b.isMine ? 'You' : shortAddress(b.bidder)}</span>
                    {b.isThreshold && <span className="tag">Sold out the auction, partly refunded</span>}
                  </td>
                  <td className="num">{formatUnits(b.amount, 8)} ETH</td>
                  <td className="num">{formatPrice(b.price)}</td>
                  <td className="num">{formatClock(b.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
