import { TOKEN } from '../config'

const STEPS = [
  {
    title: 'The price falls for 20 minutes',
    body: 'It starts high and drops a little every second until it reaches the reserve price.',
  },
  {
    title: 'You commit ETH',
    body: 'Bid whenever the price feels right. You can bid more than once.',
  },
  {
    title: 'Everyone pays the same price',
    body: `The auction ends when bids can buy every ${TOKEN.symbol}, or when time runs out. That moment sets the clearing price for all bidders.`,
  },
  {
    title: 'You claim tokens and change',
    body: 'Your ETH divided by the clearing price is your tokens. Anything left over comes back to you, and unsold tokens are burned.',
  },
]

export function HowItWorks() {
  return (
    <section className="how" aria-labelledby="how-title">
      <h2 id="how-title" className="how__title">
        How the auction works
      </h2>
      <ol className="how__steps">
        {STEPS.map((s) => (
          <li key={s.title} className="how__step">
            <h3 className="how__step-title">{s.title}</h3>
            <p className="how__step-body">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
