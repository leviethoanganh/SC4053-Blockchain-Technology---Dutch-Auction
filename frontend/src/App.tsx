import { BidFeed } from './components/BidFeed'
import { BidForm } from './components/BidForm'
import { DemandBar } from './components/DemandBar'
import { DemoControls } from './components/DemoControls'
import { FinalizePanel } from './components/FinalizePanel'
import { Header } from './components/Header'
import { HowItWorks } from './components/HowItWorks'
import { PositionPanel } from './components/PositionPanel'
import { PriceClock } from './components/PriceClock'
import { StartPanel } from './components/StartPanel'
import { StatusHeading } from './components/StatusHeading'
import { WalletNotice } from './components/WalletNotice'
import { useAuction } from './hooks/useAuction'

export default function App() {
  const { view, actions, tx, demo, status, problem } = useAuction()

  return (
    <div className="page">
      <Header />
      <WalletNotice />
      {problem && (
        <div className="notice notice--error" role="alert">
          <p className="notice__text">{problem}</p>
        </div>
      )}

      <main className="main">
        <section className="stage">
          <PriceClock view={view} />
          <div className="stage__side">
            <StatusHeading view={view} />
            <DemandBar view={view} />
            {view.phase === 'not-started' ? (
              <StartPanel actions={actions} tx={tx} loading={status === 'loading'} />
            ) : view.phase === 'live' ? (
              <BidForm view={view} actions={actions} tx={tx} />
            ) : (
              <FinalizePanel view={view} actions={actions} tx={tx} />
            )}
          </div>
        </section>

        <div className="ledger">
          <PositionPanel view={view} actions={actions} tx={tx} />
          <BidFeed view={view} />
        </div>

        <HowItWorks />

        {demo && <DemoControls demo={demo} />}
      </main>
    </div>
  )
}
