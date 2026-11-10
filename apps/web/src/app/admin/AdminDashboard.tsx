"use client";

import { useMemo, useState } from "react";

interface Setting {
  key: string;
  value: unknown;
  version: number;
  updatedAt: string;
  title: string;
  description: string;
}

interface LegalDocument {
  id: string;
  documentType: string;
  locale: string;
  version: number;
  status: string;
  title: string;
  bodyMd: string;
}

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

function SettingCard({ initial, editable }: { initial: Setting; editable: boolean }) {
  const [setting, setSetting] = useState(initial);
  const [text, setText] = useState(JSON.stringify(initial.value, null, 2));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <article className="card" id={`setting-${setting.key}`}>
    <h2>{setting.title}</h2><p className="muted">{setting.description}</p>
    <textarea className="code" aria-label={`${setting.title} JSON`} value={text} disabled={!editable || busy} onChange={(event) => setText(event.target.value)} />
    <p className="muted">Version {setting.version}</p>
    {message && <p className={message.startsWith("Saved") ? "success" : "error"} role="status">{message}</p>}
    <button disabled={!editable || busy} onClick={async () => {
      setMessage(""); setBusy(true);
      let value: unknown;
      try { value = JSON.parse(text); } catch { setMessage("Invalid JSON."); setBusy(false); return; }
      const response = await fetch(`/api/admin/settings/${setting.key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify({ value, expectedVersion: setting.version }),
      });
      const body = await response.json() as { setting?: Setting; detail?: string };
      if (!response.ok || !body.setting) { setMessage(body.detail ?? "Update failed."); setBusy(false); return; }
      setSetting({ ...setting, ...body.setting }); setText(JSON.stringify(body.setting.value, null, 2)); setMessage(`Saved as version ${body.setting.version}.`); setBusy(false);
    }}>Save setting</button>
  </article>;
}

function LegalCard({ initial, editable }: { initial: LegalDocument; editable: boolean }) {
  const [document, setDocument] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [bodyMd, setBodyMd] = useState(initial.bodyMd);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const isDraft = document.status === "DRAFT";
  async function save() {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/admin/legal/${document.id}`, { method: "PATCH", headers: { "content-type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify({ title, bodyMd }) });
    const result = await response.json() as { detail?: string };
    setMessage(response.ok ? "Draft saved." : (result.detail ?? "Save failed.")); setBusy(false);
  }
  async function approve() {
    if (!window.confirm("Approve this exact legal text for production? Approved content is immutable.")) return;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/admin/legal/${document.id}/approve`, { method: "POST", headers: { "x-csrf-token": csrf() } });
    const result = await response.json() as { detail?: string };
    if (response.ok) { setDocument({ ...document, status: "APPROVED" }); setMessage("Approved for production."); }
    else setMessage(result.detail ?? "Approval failed.");
    setBusy(false);
  }
  return <article className="card">
    <div className="actions"><strong>{document.documentType}</strong><span className="muted">v{document.version} · {document.status}</span></div>
    <label>Title<input value={title} disabled={!editable || !isDraft || busy} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>Markdown<textarea value={bodyMd} disabled={!editable || !isDraft || busy} onChange={(event) => setBodyMd(event.target.value)} /></label>
    {message && <p role="status" className={message.includes("failed") ? "error" : "success"}>{message}</p>}
    {isDraft && <div className="actions"><button className="secondary" disabled={!editable || busy} onClick={save}>Save draft</button><button disabled={!editable || busy} onClick={approve}>Approve</button></div>}
  </article>;
}

export function AdminDashboard({ settings, documents, events, role }: { settings: Setting[]; documents: LegalDocument[]; events: unknown[]; role: "OWNER" | "SUPPORT" }) {
  const [section, setSection] = useState<"overview" | "settings" | "legal" | "audit">("overview");
  const draftCount = useMemo(() => documents.filter((document) => document.status === "DRAFT").length, [documents]);
  const editable = role === "OWNER";
  return <div className="admin-shell">
    <nav className="admin-nav" aria-label="Admin sections">
      {(["overview", "settings", "legal", "audit"] as const).map((name) => <button key={name} className="secondary" onClick={() => setSection(name)}>{name[0]!.toUpperCase() + name.slice(1)}</button>)}
    </nav>
    <div>
      {section === "overview" && <>
        <h1>Production overview</h1>
        <div className="grid">
          <section className="card"><h2>Legal readiness</h2><p>{draftCount === 0 ? "All current documents are approved." : `${draftCount} draft documents block registration and signing.`}</p></section>
          <section className="card"><h2>Environment</h2><p>Production · us-east-1</p><p className="muted">Role: {role}</p></section>
          <section className="card"><h2>Product scope</h2><p>No custody. No payments between parties. No scores or ratings.</p></section>
        </div>
      </>}
      {section === "settings" && <><h1>Settings</h1><p className="muted">Validated, versioned and audited. Sensitive changes require a login less than five minutes old.</p>{settings.map((setting) => <SettingCard key={setting.key} initial={setting} editable={editable} />)}</>}
      {section === "legal" && <><h1>Legal documents</h1><p className="notice">Approval is a production action. Review the full text with qualified counsel before approval.</p>{documents.map((document) => <LegalCard key={document.id} initial={document} editable={editable} />)}</>}
      {section === "audit" && <><h1>Audit log</h1><pre className="card audit">{JSON.stringify(events, null, 2)}</pre></>}
    </div>
  </div>;
}
