export function PublicFooter() {
  return <footer className="site-footer">
    <div className="footer-inner">
      <div><strong>Theckards</strong><p>Verifiable records for everyday agreements.</p></div>
      <nav className="footer-nav" aria-label="Legal and verification">
        <a href="/verify">Verify</a>
        <a href="/legal/terms">Terms</a>
        <a href="/legal/privacy">Privacy</a>
        <a href="/legal/esign">ESIGN</a>
        <a href="/legal/notice">Notice</a>
      </nav>
    </div>
  </footer>;
}
