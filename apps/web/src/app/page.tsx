export default function Home() {
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">Theckards</a>
        <nav className="actions" aria-label="Account">
          <a className="button secondary" href="/api/auth/login">Sign in</a>
          <a className="button" href="/api/auth/login">Create an agreement</a>
        </nav>
      </header>
      <main className="shell">
        <section className="hero">
          <h1>Everyday agreements, recorded clearly.</h1>
          <p>Create a guided agreement, collect both electronic signatures and verify the final record. Theckards never receives or moves money between parties.</p>
          <div className="actions"><a className="button" href="/api/auth/login">Get started</a></div>
        </section>
        <section className="card" aria-label="Important notice">
          <strong>Important notice</strong>
          <p className="muted">Theckards provides a verifiable record. It is not legal advice, a payment guarantee or identity certification.</p>
        </section>
      </main>
    </>
  );
}
