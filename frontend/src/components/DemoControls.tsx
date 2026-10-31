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
          This page simulates the auction in your browser. No contract or real ETH is involved yet.
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
