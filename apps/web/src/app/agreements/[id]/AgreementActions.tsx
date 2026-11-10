"use client";

import { useEffect, useState } from "react";
import { SignForm } from "../../components/SignForm";

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

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
}

export function AgreementActions(props: AgreementActionsProps) {
  const { id, lockVersion, state, renderStatus } = props;
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const waitingForSeal = state === "EXECUTED" && !props.finalSealId;
  useEffect(() => {
    if (renderStatus !== "PENDING" && !waitingForSeal) return;
    const timer = window.setTimeout(() => window.location.reload(), 3_000);
    return () => window.clearTimeout(timer);
  }, [renderStatus, waitingForSeal]);
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
  const canSign = renderStatus === "READY" && !props.creatorSignedAt && ["DRAFT", "PENDING_SIGNATURES"].includes(state);
  return <>
    <section className="card">
      <h2>Signatures</h2>
      <p>You: {props.creatorSignedAt ? <>signed as <strong>{props.creatorSignedName}</strong> on {new Date(props.creatorSignedAt).toUTCString()}</> : "not signed yet"}</p>
      <p>{props.counterpartyName ?? "Counterparty"}: {props.counterpartySignedAt ? <>signed as <strong>{props.counterpartySignedName}</strong> on {new Date(props.counterpartySignedAt).toUTCString()}</> : props.counterpartyName ? "not signed yet" : "not invited yet"}</p>
      {waitingForSeal && <p aria-live="polite">Both parties signed. The sealed record is being generated…</p>}
      {props.finalSealId && <p><a className="button" href={`/api/agreements/${id}/documents/final`}>Download sealed PDF</a> <span className="muted">Seal ID {props.finalSealId}</span></p>}
    </section>
    {canSign && <SignForm
      codeUrl={`/api/agreements/${id}/otp`}
      submitUrl={`/api/agreements/${id}/sign`}
      headers={() => ({ "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID(), "if-match": `"${lockVersion}"` })}
      onDone={() => window.location.reload()}
    />}
    <section className="card">
      <h2>Actions</h2>
      {renderStatus === "PENDING" && <p aria-live="polite">The PDF preview is being generated…</p>}
      {renderStatus === "FAILED" && <p className="error">Preview generation failed. Support has been notified.</p>}
      {renderStatus === "READY" && <a className="button secondary" href={`/api/agreements/${id}/preview`} target="_blank">Open PDF preview</a>}
      {state === "DRAFT" && renderStatus === "READY" && <form onSubmit={(event) => { event.preventDefault(); void mutate("invite", { email, displayName }); }}>
        <h3>Invite the counterparty</h3>
        <label htmlFor="counterparty-name">Name</label><input id="counterparty-name" required maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        <label htmlFor="counterparty-email">Email (optional)</label><input id="counterparty-email" type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} />
        <p className="muted">With an email, a private one-use link is emailed. Leave it empty to invite in person: you will get a QR code for the other party to scan.</p>
        <button disabled={busy}>{email ? "Send invitation" : "Create QR invitation"}</button>
      </form>}
      {state === "PENDING_SIGNATURES" && !props.counterpartySignedAt && <InviteQr id={id} />}
      {state === "REVISION_REQUESTED" && <p className="notice">The counterparty requested changes. Edit the terms to create a new version, then invite them again.</p>}
      {["DRAFT", "PENDING_SIGNATURES", "REVISION_REQUESTED"].includes(state) && <p><button className="danger" disabled={busy} onClick={() => { if (window.confirm("Cancel this agreement?")) void mutate("cancel"); }}>Cancel agreement</button></p>}
      {message && <p className="error" role="alert">{message}</p>}
    </section>
  </>;
}

function InviteQr({ id }: { id: string }) {
  const [invite, setInvite] = useState<{ url: string; svg: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  return <div className="card">
    <h3>Invite in person</h3>
    {!invite
      ? <button type="button" className="secondary" onClick={async () => {
          setError("");
          const response = await fetch(`/api/agreements/${id}/invite/qr`);
          const body = await response.json() as { url?: string; svg?: string; expiresAt?: string; detail?: string };
          if (!response.ok || !body.url || !body.svg || !body.expiresAt) { setError(body.detail ?? "Could not load the invitation."); return; }
          setInvite({ url: body.url, svg: body.svg, expiresAt: body.expiresAt });
        }}>Show QR code</button>
      : <>
        <p>Ask the other party to scan this code with their phone camera. They review the agreement, verify their email and sign.</p>
        {/* SVG is generated server-side by the qrcode library from our own URL. */}
        <div role="img" aria-label="QR code with the private invitation link" style={{ width: 240, maxWidth: "100%", background: "white", padding: 8 }} dangerouslySetInnerHTML={{ __html: invite.svg }} />
        <p className="muted">Private, single-use link. Expires {new Date(invite.expiresAt).toUTCString()}. Anyone with this code can open the invitation, so show it only to the other party.</p>
        <button type="button" className="secondary" onClick={async () => { await navigator.clipboard.writeText(invite.url); setCopied(true); }}>{copied ? "Link copied" : "Copy link"}</button>
      </>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
