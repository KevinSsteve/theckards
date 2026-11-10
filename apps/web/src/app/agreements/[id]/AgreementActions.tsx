"use client";

import { useCallback, useEffect, useState } from "react";

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

async function post(url: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...(body ? { "content-type": "application/json" } : {}), "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID(), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: response.ok, data };
}

const detail = (data: Record<string, unknown>, fallback: string) => typeof data.detail === "string" ? data.detail : fallback;

export interface AgreementActionsProps {
  id: string;
  lockVersion: number;
  state: string;
  renderStatus: string;
  creatorSignedName: string | null;
  creatorSignedAt: string | null;
  counterpartyName: string | null;
  counterpartySignedName: string | null;
  counterpartySignedAt: string | null;
  finalSealId: string | null;
  viewerIsCreator: boolean;
}

export function AgreementActions(props: AgreementActionsProps) {
  const { id, lockVersion, state, renderStatus } = props;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const waitingForSeal = state === "EXECUTED" && !props.finalSealId;
  useEffect(() => {
    if (renderStatus !== "PENDING" && !waitingForSeal) return;
    const timer = window.setTimeout(() => window.location.reload(), 3_000);
    return () => window.clearTimeout(timer);
  }, [renderStatus, waitingForSeal]);

  const creator = props.viewerIsCreator;
  const open = creator && ["DRAFT", "PENDING_SIGNATURES"].includes(state) && renderStatus === "READY";
  const canSign = open && !props.creatorSignedAt;
  const canShowQr = open && !!props.creatorSignedAt && !props.counterpartySignedAt;
  return <>
    <section className="card">
      <h2>Signatures</h2>
      <p>{creator ? "You" : "Creator"}: {props.creatorSignedAt ? <>signed as <strong>{props.creatorSignedName}</strong> on {new Date(props.creatorSignedAt).toUTCString()}</> : "not signed yet"}</p>
      <p>{creator ? "Other party" : "You"}: {props.counterpartySignedAt ? <>signed as <strong>{props.counterpartySignedName}</strong> on {new Date(props.counterpartySignedAt).toUTCString()}</> : "not signed yet"}</p>
      {waitingForSeal && <p aria-live="polite">Both parties signed. The sealed record is being generated…</p>}
      {props.finalSealId && <p className="actions"><a className="button" href={`/api/agreements/${id}/documents/final`}>Download sealed PDF</a><a className="button secondary" href={`/api/agreements/${id}/documents/final/receipt`}>Download receipt</a><span className="muted">Seal ID {props.finalSealId}</span></p>}
    </section>
    {canSign && <CreatorSignForm id={id} lockVersion={lockVersion} />}
    {canShowQr && <InPersonPanel id={id} lockVersion={lockVersion} />}
    <section className="card">
      <h2>Actions</h2>
      {renderStatus === "PENDING" && <p aria-live="polite">The PDF preview is being generated…</p>}
      {renderStatus === "FAILED" && <p className="error">Preview generation failed. Support has been notified.</p>}
      {renderStatus === "READY" && <a className="button secondary" href={`/api/agreements/${id}/preview`} target="_blank">Open PDF preview</a>}
      {creator && state === "REVISION_REQUESTED" && <p className="notice">Changes were requested. Edit the terms to create a new version, then sign again.</p>}
      {creator && ["DRAFT", "PENDING_SIGNATURES", "REVISION_REQUESTED"].includes(state) && <p><button className="danger" disabled={busy} onClick={async () => {
        if (!window.confirm("Cancel this agreement?")) return;
        setBusy(true); setMessage("");
        const result = await post(`/api/agreements/${id}/cancel`, undefined, { "if-match": `"${lockVersion}"` });
        if (!result.ok) { setMessage(detail(result.data, "Action failed.")); setBusy(false); return; }
        window.location.reload();
      }}>Cancel agreement</button></p>}
      {message && <p className="error" role="alert">{message}</p>}
    </section>
  </>;
}

function CreatorSignForm({ id, lockVersion }: { id: string; lockVersion: number }) {
  const [typedName, setTypedName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <form className="card" onSubmit={async (event) => {
    event.preventDefault();
    setBusy(true); setMessage("");
    const result = await post(`/api/agreements/${id}/sign`, { typedName, consent: true }, { "if-match": `"${lockVersion}"` });
    if (!result.ok) { setMessage(detail(result.data, "Signing failed.")); setBusy(false); return; }
    window.location.reload();
  }}>
    <h2>1. Sign this agreement</h2>
    <p className="notice">Review before signing. Not legal advice. Theckards records your electronic signature from your signed-in account; it does not verify identity or guarantee payment.</p>
    <label htmlFor="typed-name">Full name (typed signature)</label>
    <input id="typed-name" autoComplete="name" required minLength={3} maxLength={120} value={typedName} onChange={(event) => setTypedName(event.target.value)} />
    <label><input style={{ width: "auto", marginRight: ".5rem" }} type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
      I agree to sign electronically under the <a href="/legal/esign" target="_blank">Electronic Signature Consent</a>, and I accept the <a href="/legal/terms" target="_blank">Terms</a> and <a href="/legal/privacy" target="_blank">Privacy Policy</a>.</label>
    <button disabled={busy || !consent || typedName.trim().length < 3}>{busy ? "Signing…" : "Sign"}</button>
    {message && <p className="error" role="alert">{message}</p>}
  </form>;
}

interface CreatorView { status: string; expiresAt: string | null; counterpartyTypedName: string | null; attemptsLeft: number; agreementState: string }

function InPersonPanel({ id, lockVersion }: { id: string; lockVersion: number }) {
  const [qr, setQr] = useState<{ svg: string; expiresAt: string } | null>(null);
  const [view, setView] = useState<CreatorView | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/agreements/${id}/in-person`);
    if (!response.ok) return;
    const next = await response.json() as CreatorView;
    setView(next);
    if (next.agreementState === "EXECUTED") window.location.reload();
  }, [id]);

  // Polls from the moment the panel mounts, not only after this tab asked for a QR code. The counterparty may
  // already have signed and be holding their six-digit code when the creator reloads the page or returns to it
  // on another tab; without this, the confirmation form never appeared and the only way forward was a new QR
  // code, which invalidates the code the other person is showing.
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function start() {
    setBusy(true); setMessage(""); setCode("");
    const result = await post(`/api/agreements/${id}/in-person`, undefined, { "if-match": `"${lockVersion}"` });
    setBusy(false);
    if (!result.ok || typeof result.data.svg !== "string") { setMessage(detail(result.data, "Could not create the QR code.")); return; }
    setQr({ svg: result.data.svg, expiresAt: String(result.data.expiresAt) });
  }

  const awaiting = view?.status === "AWAITING_CONFIRMATION";
  const ended = view && ["EXPIRED", "CANCELLED"].includes(view.status);
  return <section className="card">
    <h2>2. Sign with the other party, in person</h2>
    {!qr && !awaiting && !ended && <>
      <p>With the other party next to you, show them a QR code. They scan it with their phone camera, review the agreement and sign on their own phone. Their phone then shows a 6-digit code that you type here.</p>
      <button type="button" disabled={busy} onClick={start}>Show QR code</button>
    </>}
    {qr && !awaiting && !ended && <>
      <p>Ask the other party to scan this code with their phone camera.</p>
      {/* SVG is generated server-side by the qrcode library from our own URL. */}
      <div role="img" aria-label="QR code to sign this agreement" style={{ width: 260, maxWidth: "100%", background: "white", padding: 8 }} dangerouslySetInnerHTML={{ __html: qr.svg }} />
      <p className="muted">Single use. Expires {new Date(qr.expiresAt).toLocaleTimeString()}. Show it only to the other party.</p>
    </>}
    {awaiting && <form onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true); setMessage("");
      const result = await post(`/api/agreements/${id}/in-person/confirm`, { code });
      if (!result.ok) { setMessage(detail(result.data, "Confirmation failed.")); setBusy(false); setCode(""); void refresh(); return; }
      window.location.reload();
    }}>
      <p><strong>{view?.counterpartyTypedName}</strong> signed on their device.</p>
      <label htmlFor="confirm-code">Type the 6-digit code shown on their screen</label>
      <input id="confirm-code" inputMode="numeric" autoComplete="off" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} style={{ fontSize: "1.5rem", letterSpacing: ".3em", maxWidth: 220 }} />
      <p className="muted">Only confirm if the person in front of you is the one who signed. {view?.attemptsLeft} attempt(s) left.</p>
      <button disabled={busy || code.length !== 6}>{busy ? "Confirming…" : "Confirm signature"}</button>
    </form>}
    {ended && <><p>{view?.status === "EXPIRED" ? "The code expired." : "This QR code is no longer valid."}</p><button type="button" disabled={busy} onClick={start}>Show a new QR code</button></>}
    {message && <p className="error" role="alert">{message}</p>}
  </section>;
}
