"use client";

import { useMemo, useState } from "react";
import { legalDocumentApprovalBlockers, type LegalDocumentType } from "@theckards/domain";
import { Button } from "../components/Button";

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
  documentType: LegalDocumentType;
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
    <textarea className="code" aria-label={`${setting.title} JSON`} value={text} disabled={!editable} readOnly={busy} onChange={(event) => setText(event.target.value)} />
    <p className="muted">Version {setting.version}</p>
    {message && <p className={message.startsWith("Saved") ? "success" : "error"} role="status">{message}</p>}
    <Button busy={busy} disabled={!editable} onClick={async () => {
      setMessage(""); setBusy(true);
      let value: unknown;
      try { value = JSON.parse(text); } catch { setMessage("Invalid JSON."); setBusy(false); return; }
      const response = await fetch(`/api/admin/settings/${setting.key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ value, expectedVersion: setting.version }),
      });
      const body = await response.json() as { setting?: Setting; detail?: string };
      if (!response.ok || !body.setting) { setMessage(body.detail ?? "Update failed."); setBusy(false); return; }
      setSetting({ ...setting, ...body.setting }); setText(JSON.stringify(body.setting.value, null, 2)); setMessage(`Saved as version ${body.setting.version}.`); setBusy(false);
    }}>Save setting</Button>
  </article>;
}

function LegalCard({ initial, editable }: { initial: LegalDocument; editable: boolean }) {
  const [document, setDocument] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [bodyMd, setBodyMd] = useState(initial.bodyMd);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const isDraft = document.status === "DRAFT";
  const dirty = title !== document.title || bodyMd !== document.bodyMd;
  const blockers = isDraft ? legalDocumentApprovalBlockers(document.documentType, bodyMd) : [];

  async function responseDetail(response: Response, fallback: string): Promise<string> {
    try {
      const result = await response.json() as { detail?: string };
      return result.detail ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function save() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/legal/${document.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ title, bodyMd }),
      });
      if (!response.ok) {
        setMessage({ kind: "error", text: await responseDetail(response, "The draft could not be saved.") });
        return;
      }
      setDocument({ ...document, title, bodyMd });
      setMessage({ kind: "success", text: "Draft saved." });
    } catch {
      setMessage({ kind: "error", text: "The draft could not be saved. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (dirty) {
      setMessage({ kind: "error", text: "Save your changes before approving this document." });
      return;
    }
    if (!window.confirm("Approve this exact legal text for production? Approved content is immutable.")) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/legal/${document.id}/approve`, {
        method: "POST",
        headers: { "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() },
      });
      if (!response.ok) {
        setMessage({ kind: "error", text: await responseDetail(response, "The document could not be approved.") });
        return;
      }
      setDocument({ ...document, status: "APPROVED" });
      setMessage({ kind: "success", text: "Approved for production." });
    } catch {
      setMessage({ kind: "error", text: "The document could not be approved. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const needsReauthentication = message?.kind === "error" && /sign in again|reauthentication/i.test(message.text);
  return <article className="card" id={`legal-${document.documentType.toLowerCase()}-v${document.version}`}>
    <div className="actions"><strong>{document.documentType}</strong><span className="muted">v{document.version} · {document.status}</span></div>
    <label>Title<input value={title} disabled={!editable || !isDraft} readOnly={busy} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>Markdown<textarea value={bodyMd} disabled={!editable || !isDraft} readOnly={busy} onChange={(event) => setBodyMd(event.target.value)} /></label>
    {message && <p role="status" className={message.kind}>{message.text}</p>}
    {needsReauthentication && <p><a className="button secondary" href="/api/auth/login?intent=admin&fresh=1">Sign in again to approve</a></p>}
    {!editable && isDraft && <p className="notice">Only the product owner can edit and approve this draft.</p>}
    {dirty && isDraft && <p className="muted">You have unsaved changes. Save the draft before approval.</p>}
    {blockers.length > 0 && <div className="notice"><strong>Complete before approving:</strong><ul>{blockers.map((b) => <li key={b}>{b}</li>)}</ul><span className="muted">Edit the text above, save the draft, then approve.</span></div>}
    {isDraft
      ? <div className="actions"><Button className="secondary" busy={busy} disabled={!editable || !dirty} onClick={save}>Save draft</Button><Button busy={busy} disabled={!editable || dirty || blockers.length > 0} onClick={approve}>Approve</Button></div>
      : <Button className="secondary" busy={busy} disabled={!editable} onClick={async () => {
          setBusy(true); setMessage(null);
          try {
            const response = await fetch("/api/admin/legal", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ documentType: document.documentType, locale: document.locale, title, bodyMd }) });
            if (response.ok) setMessage({ kind: "success", text: "Next draft created. Reload to edit it." });
            else setMessage({ kind: "error", text: await responseDetail(response, "The next draft could not be created.") });
          } catch {
            setMessage({ kind: "error", text: "The next draft could not be created. Check your connection and try again." });
          } finally {
            setBusy(false);
          }
        }}>Create next draft</Button>}
  </article>;
}

export function AdminDashboard({ settings, documents, events, role }: { settings: Setting[]; documents: LegalDocument[]; events: unknown[]; role: "OWNER" | "SUPPORT" }) {
  const [section, setSection] = useState<"overview" | "settings" | "legal" | "audit">("overview");
  const draftCount = useMemo(() => documents.filter((document) => document.status === "DRAFT").length, [documents]);
  const editable = role === "OWNER";
  return <div className="admin-shell">
    <nav className="admin-nav" aria-label="Admin sections">
      {(["overview", "settings", "legal", "audit"] as const).map((name) => <button key={name} className="secondary" aria-pressed={section === name} onClick={() => setSection(name)}>{name[0]!.toUpperCase() + name.slice(1)}</button>)}
    </nav>
    <div className="admin-content">
      {section === "overview" && <>
        <header className="page-header"><p className="page-kicker">Admin</p><h1>Production overview</h1><p className="lede">Current legal readiness, environment and product scope.</p></header>
        <div className="grid">
          <section className="card"><h2>Legal readiness</h2><p>{draftCount === 0 ? "All current documents are approved." : `${draftCount} draft documents block registration and signing.`}</p></section>
          <section className="card"><h2>Environment</h2><p>Production · us-east-1</p><p className="muted">Role: {role}</p></section>
          <section className="card"><h2>Product scope</h2><p>No custody. No payments between parties. No scores or ratings.</p></section>
        </div>
      </>}
      {section === "settings" && <><header className="page-header"><p className="page-kicker">Runtime configuration</p><h1>Settings</h1><p className="lede">Validated, versioned and audited. Sensitive changes require a login less than five minutes old.</p></header>{settings.map((setting) => <SettingCard key={setting.key} initial={setting} editable={editable} />)}</>}
      {section === "legal" && <><header className="page-header"><p className="page-kicker">Production content</p><h1>Legal documents</h1></header><p className="notice">Approval is a production action. Review the full text with qualified counsel before approval. Approval requires a sign-in less than five minutes old; if it expires, use the reauthentication link shown on the document.</p>{documents.map((document) => <LegalCard key={document.id} initial={document} editable={editable} />)}</>}
      {section === "audit" && <><header className="page-header"><p className="page-kicker">Activity</p><h1>Audit log</h1></header><pre className="card audit">{JSON.stringify(events, null, 2)}</pre></>}
    </div>
  </div>;
}
