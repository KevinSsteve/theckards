"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { sessionWatch } from "../../components/session-watch";

interface Dossier {
  id: string;
  status: "PENDING" | "READY" | "FAILED";
  statusLabel: string;
  bytes: number | null;
  sha256: string | null;
  sealId: string | null;
  requestedAt: string;
  readyAt: string | null;
}

interface DossierList { legalReady: boolean; canRequest: boolean; items: Dossier[] }

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

const date = (value: string) => new Date(value).toUTCString();
const size = (bytes: number) => (bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`);

export function DossierPanel({ id }: { id: string }) {
  const [view, setView] = useState<DossierList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (sessionWatch().ended()) return;
    try {
      const response = await fetch(`/api/agreements/${id}/dossier`);
      if (sessionWatch().check(response) && response.ok) setView(await response.json() as DossierList);
    } catch { /* retried by the interval */ }
  }, [id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function request(): Promise<void> {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/agreements/${id}/dossier`, {
        method: "POST",
        headers: { "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() },
      });
      if (!sessionWatch().check(response)) return;
      const data = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) setError(data.detail ?? "The dossier could not be requested.");
      await load();
    } catch {
      setError("The request failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!view) return null;
  const building = view.items.some((item) => item.status === "PENDING");

  return <section className="card" aria-labelledby="dossier-title">
    <h2 id="dossier-title">Dossier</h2>
    <p className="muted">
      The whole record as one archive: the sealed documents and their receipts, the terms and every version,
      the signatures, what each party declared, the messages, the evidence and any case. Every file is listed with
      its SHA-256, and the archive itself is sealed, so anyone can check it years from now without Theckards.
    </p>
    {!view.legalReady && <p className="notice">The dossier opens once the updated Privacy Policy is approved, because the archive includes evidence files.</p>}
    {error && <p className="error" role="alert">{error}</p>}

    {view.canRequest && <p><Button type="button" busy={busy} onClick={() => { void request(); }}>
      {busy ? "Requesting…" : view.items.length > 0 ? "Build a new dossier" : "Build the dossier"}
    </Button></p>}
    {building && <p className="muted" aria-live="polite">The archive is being built and sealed…</p>}

    {view.items.length === 0 && !building && <p className="muted">No dossier has been built yet.</p>}
    <ol className="timeline">
      {view.items.map((item) => <li key={item.id}>
        <span className="muted">{date(item.requestedAt)} · {item.statusLabel}</span>
        {item.status === "READY" && <>
          <p className="actions">
            <a className="button" href={`/api/agreements/${id}/dossier/${item.id}/file`}>Download dossier (ZIP{item.bytes ? `, ${size(item.bytes)}` : ""})</a>
            <a className="button secondary" href={`/api/agreements/${id}/dossier/${item.id}/receipt`}>Download receipt</a>
          </p>
          {item.sha256 && <p className="muted">SHA-256 <code>{item.sha256}</code></p>}
          <p className="muted">Check it at <a href="/verify">/verify</a>, or follow README.txt inside the archive. <a href="/verify/how">How verification works</a>.</p>
        </>}
      </li>)}
    </ol>
  </section>;
}
