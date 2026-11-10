"use client";

import { useEffect, useState } from "react";

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

export function AgreementActions({ id, lockVersion, state, renderStatus }: { id: string; lockVersion: number; state: string; renderStatus: string }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (renderStatus !== "PENDING") return;
    const timer = window.setTimeout(() => window.location.reload(), 2_500);
    return () => window.clearTimeout(timer);
  }, [renderStatus]);
  async function mutate(path: string, body?: unknown) {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/agreements/${id}/${path}`, {
      method: "POST",
      headers: { ...(body ? { "content-type": "application/json" } : {}), "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID(), "if-match": `"${lockVersion}"` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json() as { detail?: string };
    if (!response.ok) { setMessage(result.detail ?? "Action failed."); setBusy(false); return; }
    window.location.reload();
  }
  return <section className="card">
    <h2>Actions</h2>
    {renderStatus === "PENDING" && <p aria-live="polite">The PDF preview is being generated…</p>}
    {renderStatus === "FAILED" && <p className="error">Preview generation failed. Support has been notified.</p>}
    {renderStatus === "READY" && <a className="button secondary" href={`/api/agreements/${id}/preview`} target="_blank">Open PDF preview</a>}
    {state === "DRAFT" && renderStatus === "READY" && <form onSubmit={(event) => { event.preventDefault(); void mutate("invite", { email, displayName }); }}>
      <h3>Invite the counterparty</h3>
      <label htmlFor="counterparty-name">Name</label><input id="counterparty-name" required maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      <label htmlFor="counterparty-email">Email</label><input id="counterparty-email" type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} />
      <p className="muted">A private, one-use link is sent after you confirm.</p>
      <button disabled={busy}>Send invitation</button>
    </form>}
    {["DRAFT", "PENDING_SIGNATURES", "REVISION_REQUESTED"].includes(state) && <p><button className="danger" disabled={busy} onClick={() => { if (window.confirm("Cancel this agreement?")) void mutate("cancel"); }}>Cancel agreement</button></p>}
    {message && <p className="error" role="alert">{message}</p>}
  </section>;
}
