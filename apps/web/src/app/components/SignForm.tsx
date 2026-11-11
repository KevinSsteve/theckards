"use client";

import { useState } from "react";
import { Button } from "./Button";
import { useFocusAfter } from "./focus";

export interface SignFormProps {
  /** POST endpoint that emails a 6-digit code. */
  codeUrl: string;
  /** POST endpoint that verifies the code and records the action. */
  submitUrl: string;
  headers: () => Record<string, string>;
  extraBody?: Record<string, unknown>;
  allowRequestChanges?: boolean;
  /** QR/link invitations: the signer enters the email that receives the verification code. */
  askEmail?: boolean;
  onDone: () => void;
}

export function SignForm({ codeUrl, submitUrl, headers, extraBody, allowRequestChanges, askEmail, onDone }: SignFormProps) {
  const [email, setEmail] = useState("");
  const [typedName, setTypedName] = useState("");
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // "Email me a verification code" is replaced by the code field, so focus goes straight to it.
  const codeField = useFocusAfter<HTMLInputElement>(codeSent);

  async function post(url: string, body?: unknown): Promise<boolean> {
    setBusy(true); setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { ...headers(), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { detail?: string };
      setMessage(result.detail ?? "The request failed."); setBusy(false); return false;
    }
    setBusy(false); return true;
  }

  return <form className="card" onSubmit={async (event) => {
    event.preventDefault();
    if (await post(submitUrl, { ...extraBody, action: "sign", typedName, consent: true, code })) onDone();
  }}>
    <h2>Sign this agreement</h2>
    <p className="notice">Review before signing. Not legal advice. Theckards records your electronic signature and the email verification; it does not verify your identity or guarantee payment.</p>
    <label htmlFor="typed-name">Full name (typed signature)</label>
    <input id="typed-name" autoComplete="name" required minLength={3} maxLength={120} value={typedName} onChange={(event) => setTypedName(event.target.value)} />
    <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
      I agree to sign electronically under the <a href="/legal/esign" target="_blank">Electronic Signature Consent</a>, and I accept the <a href="/legal/terms" target="_blank">Terms</a> and <a href="/legal/privacy" target="_blank">Privacy Policy</a>, including how records are retained and deleted.</label>
    {askEmail && <>
      <label htmlFor="signer-email">Your email (receives the verification code and the sealed record)</label>
      <input id="signer-email" type="email" autoComplete="email" required maxLength={320} value={email} disabled={codeSent} onChange={(event) => setEmail(event.target.value)} />
    </>}
    {!codeSent
      ? <Button type="button" busy={busy} disabled={!consent || (askEmail && !/^\S+@\S+\.\S+$/.test(email))} onClick={async () => { if (await post(codeUrl, askEmail ? { email } : {})) { setCodeSent(true); setMessage("We emailed you a 6-digit code. It expires in 10 minutes."); } }}>Email me a verification code</Button>
      : <>
        <label htmlFor="otp-code">6-digit code</label>
        <input id="otp-code" ref={codeField} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
        <div className="actions">
          <Button busy={busy} disabled={!consent || code.length !== 6 || typedName.trim().length < 3}>{busy ? "Signing…" : "Sign"}</Button>
          {allowRequestChanges && <Button type="button" className="secondary" busy={busy} disabled={!consent || code.length !== 6} onClick={async () => {
            if (await post(submitUrl, { ...extraBody, action: "request_changes", consent: true, code })) onDone();
          }}>Request changes instead</Button>}
          <Button type="button" className="secondary" busy={busy} onClick={async () => { if (await post(codeUrl, askEmail ? { email } : {})) setMessage("A new code was sent."); }}>Resend code</Button>
          {askEmail && <Button type="button" className="secondary" busy={busy} onClick={() => { setCodeSent(false); setCode(""); setMessage(""); }}>Change email</Button>}
        </div>
      </>}
    {message && <p role="status" className={message.includes("failed") || message.includes("invalid") ? "error" : "muted"}>{message}</p>}
  </form>;
}
