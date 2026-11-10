"use client";

import { useCallback, useEffect, useState } from "react";

type View =
  | { status: "OPEN"; expiresAt: string }
  | { status: "AWAITING_CONFIRMATION"; expiresAt: string }
  | { status: "COMPLETED"; sealed: boolean; downloadReady: boolean }
  | { status: "UNAVAILABLE" };

export function InPersonSigner({ token, initial, hasDownloadSession }: { token: string; initial: View; hasDownloadSession: boolean }) {
  const base = `/api/in-person/${encodeURIComponent(token)}`;
  const [view, setView] = useState<View>(initial);
  const [code, setCode] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [downloadable, setDownloadable] = useState(hasDownloadSession);

  const refresh = useCallback(async () => {
    const response = await fetch(`${base}/status`);
    if (response.ok) setView(await response.json() as View);
  }, [base]);

  const waiting = view.status === "AWAITING_CONFIRMATION" || (view.status === "COMPLETED" && !view.sealed);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => { void refresh(); }, 2_000);
    return () => window.clearInterval(timer);
  }, [waiting, refresh]);

  async function requestCode(name: string) {
    setBusy(true); setMessage("");
    const response = await fetch(`${base}/request`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ typedName: name, consent: true }),
    });
    const data = await response.json().catch(() => ({})) as { code?: string; expiresAt?: string; detail?: string };
    setBusy(false);
    if (!response.ok || !data.code || !data.expiresAt) { setMessage(data.detail ?? "Signing failed."); return; }
    setCode(data.code);
    setView({ status: "AWAITING_CONFIRMATION", expiresAt: data.expiresAt });
  }

  async function claimDownload() {
    setBusy(true); setMessage("");
    const response = await fetch(`${base}/download-session`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } });
    const data = await response.json().catch(() => ({})) as { detail?: string };
    setBusy(false);
    if (!response.ok) { setMessage(data.detail ?? "The download is not available."); return; }
    setDownloadable(true);
  }

  if (view.status === "UNAVAILABLE") {
    return <section className="card"><h2>QR code no longer valid</h2><p>Ask the other party to show a new QR code.</p></section>;
  }
  if (view.status === "COMPLETED") {
    return <section className="card">
      <h2>Signed by both parties</h2>
      {!view.sealed && <p aria-live="polite">The sealed record is being generated…</p>}
      {view.sealed && downloadable && <>
        <p className="actions"><a className="button" href="/api/guest/documents/final">Download sealed PDF</a><a className="button secondary" href="/api/guest/documents/final/receipt">Download receipt</a></p>
        <p className="muted">Save it now: without an account you can download it only on this device, for about 2 hours. Anyone can later check that a copy is unchanged on the verification page.</p>
        <div className="notice">
          <strong>Keep access to this agreement</strong>
          <p>Sign in or create a free Theckards account to see the record later, declare delivery or payment, and exchange messages with the other party.</p>
          <a className="button" href="/api/auth/login?next=/claim">Keep access with an account</a>
        </div>
      </>}
      {view.sealed && !downloadable && view.downloadReady && <button type="button" disabled={busy} onClick={claimDownload}>Get the sealed PDF</button>}
      {view.sealed && !downloadable && !view.downloadReady && <p className="muted">The download was already opened on this device. Ask the other party for a copy.</p>}
      {message && <p className="error" role="alert">{message}</p>}
    </section>;
  }
  if (view.status === "AWAITING_CONFIRMATION" && code) {
    return <section className="card" aria-live="polite">
      <h2>Show this code to the other party</h2>
      <p style={{ fontSize: "2.75rem", fontWeight: 750, letterSpacing: ".35em", fontVariantNumeric: "tabular-nums", margin: "1rem 0" }}>{code}</p>
      <p>They type it on their screen to confirm your signature. Expires {new Date(view.expiresAt).toLocaleTimeString()}.</p>
      <button type="button" className="secondary" disabled={busy} onClick={() => requestCode(typedName)}>Show a new code</button>
      {message && <p className="error" role="alert">{message}</p>}
    </section>;
  }
  // OPEN, or AWAITING_CONFIRMATION after a reload (the code is never stored): sign again on this device for a new code.
  return <form className="card" onSubmit={(event) => { event.preventDefault(); void requestCode(typedName); }}>
    <h2>Sign this agreement</h2>
    {view.status === "AWAITING_CONFIRMATION" && <p className="muted">You already signed on this device. Sign again to show a new code.</p>}
    <label htmlFor="typed-name">Your full name (typed signature)</label>
    <input id="typed-name" autoComplete="name" required minLength={3} maxLength={120} value={typedName} onChange={(event) => setTypedName(event.target.value)} />
    <label><input style={{ width: "auto", marginRight: ".5rem" }} type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
      I agree to sign electronically under the <a href="/legal/esign" target="_blank">Electronic Signature Consent</a>, and I accept the <a href="/legal/terms" target="_blank">Terms</a> and <a href="/legal/privacy" target="_blank">Privacy Policy</a>.</label>
    <p className="muted">After you sign, a code appears here. The other party types it on their device to confirm.</p>
    <button disabled={busy || !consent || typedName.trim().length < 3}>{busy ? "Signing…" : "Sign"}</button>
    {message && <p className="error" role="alert">{message}</p>}
  </form>;
}
