"use client";

import { useState } from "react";

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

export function MfaSetup() {
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  return <section className="card mfa-card">
    {!secret ? <button onClick={async () => {
      setError("");
      const response = await fetch("/api/auth/mfa/setup", { method: "POST", headers: { "x-csrf-token": csrf() } });
      const body = await response.json() as { secret?: string; detail?: string };
      if (!response.ok || !body.secret) return setError(body.detail ?? "Could not start MFA setup.");
      setSecret(body.secret);
    }}>Generate TOTP secret</button> : <>
      <p>Add this secret to your authenticator app:</p>
      <p><code>{secret}</code></p>
      <label htmlFor="mfa-code">6-digit code</label>
      <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
      <button disabled={code.length !== 6} onClick={async () => {
        setError("");
        const response = await fetch("/api/auth/mfa/verify", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ code }) });
        const body = await response.json() as { next?: string; detail?: string };
        if (!response.ok) return setError(body.detail ?? "Code verification failed.");
        window.location.assign(body.next ?? "/api/auth/login?intent=admin");
      }}>Verify and sign in again</button>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
