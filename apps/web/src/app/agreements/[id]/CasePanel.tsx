"use client";

import { useCallback, useEffect, useState } from "react";

interface Section { heading: string; paragraphs: string[] }
interface Proposal { id: string; author: string; mine: boolean; body: string; createdAt: string; current: boolean; accepted: boolean; canAccept: boolean }
interface CaseView {
  legalReady: boolean; agreementState: string; canOpen: boolean;
  case: null | {
    id: string; status: "OPEN" | "WITHDRAWN" | "RESOLVED"; reason: string; openedBy: string; openedByMe: boolean; openedAt: string;
    evidenceWindowEndsAt: string; closedAt: string | null; canPropose: boolean; canWithdraw: boolean; proposals: Proposal[];
    addendum: null | { status: string; renderStatus: string; sections: Section[]; signatures: { name: string; mine: boolean; signedAt: string }[]; canSign: boolean; sealedDocumentId: string | null };
  };
}

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

const date = (value: string) => new Date(value).toUTCString();

export function CasePanel({ id }: { id: string }) {
  const [view, setView] = useState<CaseView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [proposal, setProposal] = useState("");
  const [typedName, setTypedName] = useState("");
  const [consent, setConsent] = useState(false);
  const [showOpen, setShowOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/agreements/${id}/case`);
      if (response.ok) setView(await response.json() as CaseView);
    } catch { /* retried by the interval */ }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function post(path: string, body?: unknown): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/agreements/${id}/case${path}`, {
        method: "POST",
        headers: { ...(body ? { "content-type": "application/json" } : {}), "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({})) as { state?: string; detail?: string };
      if (!response.ok) { setError(data.detail ?? "The request failed."); return false; }
      if (data.state && view && data.state !== view.agreementState) { window.location.reload(); return true; }
      await load();
      return true;
    } catch {
      setError("The request failed. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!view) return null;
  const c = view.case;
  const showCase = c && (c.status === "OPEN" || view.agreementState === "RESOLVED");

  return <section className="card" aria-labelledby="case-title">
    <h2 id="case-title">Case</h2>
    <p className="muted">A case records each party's view and proposals. Theckards does not decide who is right, does not move money and does not enforce any outcome. A resolution exists only if both parties accept and sign it.</p>
    {!view.legalReady && <p className="notice">Cases open after the updated Privacy Policy and ESIGN consent are approved.</p>}
    {error && <p className="error" role="alert">{error}</p>}

    {!showCase && view.canOpen && (showOpen
      ? <form onSubmit={async (event) => { event.preventDefault(); if (window.confirm("Open a case? The agreement terms stay frozen while it is open.") && await post("", { reason })) setReason(""); }}>
          <label htmlFor="case-reason">What is not going as agreed? (facts only)</label>
          <textarea id="case-reason" minLength={3} maxLength={2000} required value={reason} onChange={(event) => setReason(event.target.value)} />
          <div className="actions"><button disabled={busy || reason.trim().length < 3}>Open case</button><button type="button" className="secondary" onClick={() => setShowOpen(false)}>Cancel</button></div>
        </form>
      : <button type="button" className="secondary" onClick={() => setShowOpen(true)}>Open a case</button>)}
    {c && c.status === "WITHDRAWN" && !showCase && <p className="muted">The last case was withdrawn on {c.closedAt ? date(c.closedAt) : ""}.</p>}

    {showCase && c && <>
      <p><strong>{c.status === "OPEN" ? "Open" : "Resolved"}</strong> · opened by {c.openedBy}{c.openedByMe ? " (you)" : ""} on {date(c.openedAt)}</p>
      <blockquote style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.reason}</blockquote>
      {c.status === "OPEN" && <p className="muted">Evidence window (informational only, nothing happens automatically): until {date(c.evidenceWindowEndsAt)}.</p>}

      <h3>Proposals</h3>
      {c.proposals.length === 0 && <p className="muted">No proposals yet.</p>}
      <ol className="timeline">
        {c.proposals.map((p) => <li key={p.id}>
          <span className="muted">{date(p.createdAt)} · {p.author}{p.mine ? " (you)" : ""}{p.current ? "" : " · replaced by a newer proposal"}{p.accepted ? " · accepted" : ""}</span>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", opacity: p.current ? 1 : 0.6 }}>{p.body}</div>
          {p.canAccept && <button disabled={busy} onClick={async () => {
            if (window.confirm(`Accept this proposal from ${p.author}? A resolution addendum with exactly this text will be prepared for both of you to sign.`)) await post(`/proposals/${p.id}/accept`);
          }}>Accept this proposal</button>}
        </li>)}
      </ol>
      {c.canPropose && <form onSubmit={async (event) => { event.preventDefault(); if (await post("/proposals", { body: proposal })) setProposal(""); }}>
        <label htmlFor="proposal">Your proposal (replaces your previous one)</label>
        <textarea id="proposal" minLength={3} maxLength={4000} value={proposal} onChange={(event) => setProposal(event.target.value)} />
        <button disabled={busy || proposal.trim().length < 3}>Send proposal</button>
      </form>}

      {c.addendum && <div className="card">
        <h3>Resolution addendum</h3>
        {c.addendum.sections.map((s) => <div key={s.heading}><strong>{s.heading}</strong>{s.paragraphs.map((t) => <p key={t} style={{ whiteSpace: "pre-wrap" }}>{t}</p>)}</div>)}
        {c.addendum.renderStatus === "READY" && <p><a className="button secondary" href={`/api/agreements/${id}/case/addendum/preview`} target="_blank" rel="noreferrer">Open the exact addendum PDF</a></p>}
        {c.addendum.renderStatus !== "READY" && c.addendum.status !== "CANCELLED" && <p className="muted" aria-live="polite">The addendum document is being generated…</p>}
        <p>Signatures: {c.addendum.signatures.length === 0 ? "none yet" : c.addendum.signatures.map((s) => `${s.name}${s.mine ? " (you)" : ""} on ${date(s.signedAt)}`).join("; ")}</p>
        {c.addendum.canSign && <form onSubmit={async (event) => { event.preventDefault(); await post("/addendum/sign", { typedName, consent: true }); }}>
          <label htmlFor="addendum-name">Full name (typed signature)</label>
          <input id="addendum-name" autoComplete="name" minLength={3} maxLength={120} value={typedName} onChange={(event) => setTypedName(event.target.value)} />
          <label><input type="checkbox" style={{ width: "auto", marginRight: ".5rem" }} checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            I agree to sign this addendum electronically under the <a href="/legal/esign" target="_blank">Electronic Signature Consent</a>.</label>
          <button disabled={busy || !consent || typedName.trim().length < 3}>Sign addendum</button>
        </form>}
        {c.addendum.status === "SEALED" && <p className="actions"><a className="button" href={`/api/agreements/${id}/documents/addendum`}>Download sealed addendum</a><span className="muted">Seal ID {c.addendum.sealedDocumentId}</span></p>}
        {c.status === "OPEN" && c.addendum.signatures.length >= 2 && c.addendum.status !== "SEALED" && <p className="muted" aria-live="polite">Both parties signed. The addendum is being sealed…</p>}
      </div>}

      {c.canWithdraw && <p><button className="danger" disabled={busy} onClick={async () => {
        if (window.confirm("Withdraw the case? The agreement returns to its signed state; the case history stays on the record.")) await post("/withdraw");
      }}>Withdraw case</button></p>}
    </>}
  </section>;
}
