"use client";

import { useCallback, useEffect, useState } from "react";

interface Slot { kind: string; label: string; role: string; partyName: string; mine: boolean; declaredAt: string | null; note: string | null }
interface Evidence {
  id: string; filename: string; contentType: string; note: string | null; bytes: number | null; sha256: string | null;
  status: string; statusLabel: string; mine: boolean; uploadedBy: string; createdAt: string; downloadable: boolean;
}
interface EvidenceList { legalReady: boolean; canUpload: boolean; items: Evidence[] }

interface Entry { at: string; type: string; partyName: string | null; mine: boolean; text: string }
interface RecordView {
  state: string; myRole: string; canConfirm: boolean; canWrite: boolean; legalReady: boolean;
  outcome: string; outcomeLabel: string; slots: Slot[]; timeline: Entry[];
}

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

const roleName = (role: string) => role.charAt(0) + role.slice(1).toLowerCase();

export function RecordPanel({ id }: { id: string }) {
  const [record, setRecord] = useState<RecordView | null>(null);
  const [evidence, setEvidence] = useState<EvidenceList | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileNote, setFileNote] = useState("");
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"message" | "note">("message");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [recordResponse, evidenceResponse] = await Promise.all([
        fetch(`/api/agreements/${id}/record`),
        fetch(`/api/agreements/${id}/evidence`),
      ]);
      if (!recordResponse.ok) { setError("The record could not be loaded."); return; }
      setRecord(await recordResponse.json() as RecordView);
      if (evidenceResponse.ok) setEvidence(await evidenceResponse.json() as EvidenceList);
    } catch {
      setError("The record could not be loaded. Check your connection.");
    }
  }, [id]);

  /** Uploads straight to S3 with the presigned PUT, then tells the server the upload finished. */
  async function uploadEvidence() {
    if (!file) return;
    setUploading("Preparing the upload…"); setError("");
    try {
      const created = await fetch(`/api/agreements/${id}/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ filename: file.name, contentType: file.type, bytes: file.size, ...(fileNote.trim() ? { note: fileNote.trim() } : {}) }),
      });
      const data = await created.json().catch(() => ({})) as { id?: string; uploadUrl?: string; detail?: string };
      if (!created.ok || !data.uploadUrl || !data.id) { setError(data.detail ?? "The file was not accepted."); return; }
      setUploading("Uploading…");
      const put = await fetch(data.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
      if (!put.ok) { setError("The upload failed. Try again."); return; }
      setUploading("Checking the file for malware…");
      await fetch(`/api/agreements/${id}/evidence/${data.id}/confirm`, {
        method: "POST", headers: { "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() },
      });
      setFile(null); setFileNote("");
      await load();
    } catch {
      setError("The upload failed. Check your connection and try again.");
    } finally {
      setUploading("");
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function post(path: string, body: unknown): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/agreements/${id}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({})) as { state?: string; detail?: string };
      if (!response.ok) { setError(data.detail ?? "The request failed."); return false; }
      if (data.state && record && data.state !== record.state) { window.location.reload(); return true; }
      await load();
      return true;
    } catch {
      setError("The request failed. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!record) return <section className="card"><h2>Record</h2><p className="muted">{error || "Loading…"}</p></section>;
  const limit = mode === "message" ? 4000 : 500;
  return <>
    <section className="card" aria-labelledby="confirmations-title">
      <h2 id="confirmations-title">Confirmations</h2>
      <p className="muted">Each party declares its own side. Theckards records these declarations; it does not verify delivery or payment and does not decide whether anyone met their commitments.</p>
      {!record.legalReady && <p className="notice">Declaring confirmations, messages and notes opens after the updated Privacy Policy is approved.</p>}
      <p><strong>{record.outcomeLabel}</strong></p>
      <ul className="slots">
        {record.slots.map((slot) => <li key={`${slot.kind}:${slot.role}`}>
          <strong>{slot.label}</strong> <span className="muted">— {roleName(slot.role)}: {slot.partyName}{slot.mine ? " (you)" : ""}</span><br />
          {slot.declaredAt
            ? <span>Declared by {slot.partyName} on {new Date(slot.declaredAt).toUTCString()}{slot.note ? ` — “${slot.note}”` : ""}</span>
            : slot.mine && record.canConfirm
              ? <span className="actions">
                  <input aria-label={`Optional note for ${slot.label}`} placeholder="Optional note (max 500)" maxLength={500} value={notes[slot.kind] ?? ""} onChange={(event) => setNotes({ ...notes, [slot.kind]: event.target.value })} style={{ maxWidth: 320 }} />
                  <button disabled={busy} onClick={async () => {
                    if (!window.confirm(`Declare “${slot.label}”? Declarations cannot be edited or removed.`)) return;
                    if (await post("confirmations", { kind: slot.kind, ...(notes[slot.kind]?.trim() ? { note: notes[slot.kind]!.trim() } : {}) })) setNotes({ ...notes, [slot.kind]: "" });
                  }}>Declare</button>
                </span>
              : <span className="muted">Waiting for {slot.partyName}. No confirmation recorded yet.</span>}
        </li>)}
      </ul>
    </section>
    {evidence && <section className="card" aria-labelledby="evidence-title">
      <h2 id="evidence-title">Evidence</h2>
      <p className="muted">Attach a photo or a PDF to the record. Every file is checked for malware before the other party can see it. The file is stored exactly as uploaded, so a photo may carry the place and time it was taken.</p>
      {!evidence.legalReady && <p className="notice">Attaching evidence opens after the updated Privacy Policy is approved.</p>}
      {evidence.canUpload && <form onSubmit={(event) => { event.preventDefault(); void uploadEvidence(); }}>
        <label htmlFor="evidence-file">File (JPEG, PNG, WebP or PDF, up to 25 MB)</label>
        <input id="evidence-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <label htmlFor="evidence-note">Note (optional)</label>
        <input id="evidence-note" maxLength={500} value={fileNote} onChange={(event) => setFileNote(event.target.value)} placeholder="What does this file show?" />
        <button disabled={!file || !!uploading}>{uploading || "Attach evidence"}</button>
        {uploading && <p className="muted" aria-live="polite">{uploading}</p>}
      </form>}
      <ul className="slots">
        {evidence.items.length === 0 && <li className="muted">No evidence attached yet.</li>}
        {evidence.items.map((item) => <li key={item.id}>
          <strong>{item.filename}</strong> <span className="muted">— {item.uploadedBy}{item.mine ? " (you)" : ""} · {new Date(item.createdAt).toUTCString()}{item.bytes ? ` · ${Math.ceil(item.bytes / 1024)} kB` : ""}</span>
          {item.note && <div style={{ overflowWrap: "anywhere" }}>{item.note}</div>}
          <div className={item.status === "INFECTED" || item.status === "FAILED" || item.status === "UNSUPPORTED" ? "error" : "muted"}>{item.statusLabel}</div>
          {item.downloadable && <p className="actions"><a className="button secondary" href={`/api/agreements/${id}/evidence/${item.id}/file`}>Download file</a>{item.sha256 && <span className="muted">SHA-256 {item.sha256.slice(0, 16)}…</span>}</p>}
        </li>)}
      </ul>
    </section>}
    <section className="card" aria-labelledby="record-title">
      <h2 id="record-title">Messages, notes and timeline</h2>
      {record.canWrite && <form onSubmit={async (event) => {
        event.preventDefault();
        if (!text.trim()) return;
        if (await post(mode === "message" ? "messages" : "notes", { body: text })) setText("");
      }}>
        <div className="actions" role="radiogroup" aria-label="Entry type">
          <label><input type="radio" style={{ width: "auto" }} checked={mode === "message"} onChange={() => setMode("message")} /> Message to the other party</label>
          <label><input type="radio" style={{ width: "auto" }} checked={mode === "note"} onChange={() => setMode("note")} /> Note on the record</label>
        </div>
        <textarea aria-label={mode === "message" ? "Message" : "Note"} maxLength={limit} value={text} onChange={(event) => setText(event.target.value)} />
        <p className="muted">{text.length}/{limit}. Messages and notes are permanent and visible to both parties. They are never public.</p>
        <button disabled={busy || !text.trim()}>{busy ? "Saving…" : mode === "message" ? "Send message" : "Add note"}</button>
      </form>}
      {error && <p className="error" role="alert">{error}</p>}
      <ol className="timeline">
        {record.timeline.map((entry, index) => <li key={`${entry.at}:${index}`}>
          <span className="muted">{new Date(entry.at).toUTCString()} · {entry.type.toLowerCase()}{entry.partyName ? ` · ${entry.partyName}${entry.mine ? " (you)" : ""}` : ""}</span>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.text}</div>
        </li>)}
      </ol>
    </section>
  </>;
}
