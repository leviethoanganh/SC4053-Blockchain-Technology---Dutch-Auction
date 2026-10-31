import type { DemoControls as Demo } from '../types'

/** Preview-mode only. Lets the team walk through every phase without waiting 20 minutes. */
export function DemoControls({ demo }: { demo: Demo }) {
  return (
    <aside className="demo" aria-labelledby="demo-title">
      <div>
        <h2 id="demo-title" className="demo__title">
          Preview mode
        </h2>
        <p className="demo__text">
          Your MetaMask connection is real. The auction, the other bidders and your 1.5 ETH preview balance are
          simulated in this browser, so no real ETH is sent.
        </p>
      </div>
      <div className="demo__buttons">
        <button className="button button--ghost" onClick={() => demo.skip(60)}>
          Skip 1 minute
        </button>
        <button className="button button--ghost" onClick={() => demo.skip(300)}>
          Skip 5 minutes
        </button>
        <button className="button button--ghost" onClick={demo.restart}>
          Restart auction
        </button>
      </div>
    </aside>
  )
}
