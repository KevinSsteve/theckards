"use client";

import { SignForm } from "../../components/SignForm";

export function GuestActions({ token, usable, askEmail, signedAt, state, finalAvailable, renderReady }: {
  token: string; usable: boolean; askEmail: boolean; signedAt: string | null; state: string; finalAvailable: boolean; renderReady: boolean;
}) {
  if (signedAt) {
    return <section className="card">
      <h2>You signed this agreement</h2>
      <p>Signed on {new Date(signedAt).toUTCString()}.</p>
      {state === "EXECUTED" && !finalAvailable && <p className="muted">Both parties signed. The sealed record will be emailed to you.</p>}
      {finalAvailable && <a className="button" href="/api/guest/documents/final">Download sealed PDF</a>}
    </section>;
  }
  if (state === "REVISION_REQUESTED") {
    return <section className="card"><h2>Changes requested</h2><p>The other party was notified. You will receive a new invitation if the terms change.</p></section>;
  }
  if (!usable || state !== "PENDING_SIGNATURES") {
    return <section className="card"><h2>Not available for signature</h2><p>This agreement is no longer waiting for your signature.</p></section>;
  }
  if (!renderReady) return <section className="card"><p>The document is being prepared. Reload in a moment.</p></section>;
  return <SignForm
    codeUrl={`/api/guest/${encodeURIComponent(token)}/otp`}
    submitUrl={`/api/guest/${encodeURIComponent(token)}/complete`}
    headers={() => ({})}
    askEmail={askEmail}
    allowRequestChanges
    onDone={() => window.location.reload()}
  />;
}
