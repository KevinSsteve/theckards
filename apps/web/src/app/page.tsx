import { Brand } from "./components/Brand";
import { PublicFooter } from "./components/PublicFooter";

export default function Home() {
  return (
    <>
      <header className="topbar">
        <Brand />
        <nav className="actions" aria-label="Account">
          <a className="button secondary" href="/api/auth/login">Sign in</a>
          <a className="button" href="/api/auth/login">Create</a>
        </nav>
      </header>
      <main id="main-content" tabIndex={-1} className="shell home-shell">
        <section className="hero">
          <div className="hero-copy">
            <p className="page-kicker">Create · Sign · Verify</p>
            <h1>Everyday agreements, recorded clearly.</h1>
            <p className="lede">Create a guided agreement, collect both electronic signatures and verify the final record. Theckards never receives or moves money between parties.</p>
            <div className="hero-actions">
              <a className="button" href="/api/auth/login">Create an agreement</a>
              <a className="button secondary" href="/verify">Verify a record</a>
              <p className="hero-note">No payment details. No custody of funds.</p>
            </div>
          </div>
          <aside className="record-preview" aria-label="How a Theckards record is made">
            <div className="record-preview-header"><span>Theckards record</span><span>01</span></div>
            <ol className="record-steps">
              <li><div><strong>Create</strong><span>Fill a guided agreement with the facts you choose.</span></div></li>
              <li><div><strong>Sign</strong><span>Record both parties’ electronic signatures.</span></div></li>
              <li><div><strong>Verify</strong><span>Check the sealed file without uploading it.</span></div></li>
            </ol>
            <div className="record-proof">
              <span className="mini-seal" aria-hidden="true">T</span>
              <p><strong>Integrity receipt</strong><span>Hash and signature included with the final record.</span></p>
            </div>
          </aside>
        </section>
        <section className="home-notice" aria-label="Important notice">
          <strong>Important notice</strong>
          <p>Theckards provides a verifiable record. It is not legal advice, a payment guarantee or identity certification.</p>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
