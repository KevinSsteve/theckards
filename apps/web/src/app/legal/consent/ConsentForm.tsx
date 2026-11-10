"use client";

import { useState } from "react";

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

export function ConsentForm() {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="card">
    <label><input style={{ width: "auto", marginRight: ".5rem" }} type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> I have read and accept the Terms, Privacy Policy, ESIGN consent and Important Notice.</label>
    <p className="muted">You can download or export your data from Account settings. Retention depends on the data category, not your plan.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <button disabled={!accepted || busy} onClick={async () => {
      setBusy(true); setError("");
      const response = await fetch("/api/legal/consent", { method: "POST", headers: { "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() } });
      if (!response.ok) { const body = await response.json() as { detail?: string }; setError(body.detail ?? "Could not record consent."); setBusy(false); return; }
      window.location.assign("/account");
    }}>{busy ? "Recording…" : "Accept and continue"}</button>
  </div>;
}
