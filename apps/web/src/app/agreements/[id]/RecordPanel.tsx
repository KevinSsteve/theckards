"use client";

import { useCallback, useEffect, useState } from "react";

interface Slot { kind: string; label: string; role: string; partyName: string; mine: boolean; declaredAt: string | null; note: string | null }
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"message" | "note">("message");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/agreements/${id}/record`);
      if (!response.ok) { setError("The record could not be loaded."); return; }
      setRecord(await response.json() as RecordView);
    } catch {
      setError("The record could not be loaded. Check your connection.");
    }
  }, [id]);

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
