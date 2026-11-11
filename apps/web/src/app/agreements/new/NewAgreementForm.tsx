"use client";

import { useMemo, useState } from "react";
import type { TemplateDefinition, TemplateId } from "@theckards/domain";
import { Button } from "../../components/Button";

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

export function NewAgreementForm({ templates }: { templates: TemplateDefinition[] }) {
  const [templateId, setTemplateId] = useState<TemplateId>("purchase_sale");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const template = useMemo(() => templates.find((item) => item.id === templateId)!, [templates, templateId]);
  return <form className="card form-card" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch("/api/agreements", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ templateId, title, fields }),
    });
    const body = await response.json() as { agreement?: { id: string }; detail?: string };
    if (!response.ok || !body.agreement) { setError(body.detail ?? "Agreement creation failed."); setBusy(false); return; }
    window.location.assign(`/agreements/${body.agreement.id}`);
  }}>
    <label htmlFor="template">Template</label>
    <select id="template" value={templateId} onChange={(event) => { setTemplateId(event.target.value as TemplateId); setFields({}); }}>
      {templates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
    </select>
    <p className="muted">{template.summary}</p>
    <label htmlFor="title">Agreement title</label>
    <input id="title" required minLength={3} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Sale of iPhone 14" />
    {template.fields.map((field) => <div key={field.key}>
      <label htmlFor={field.key}>{field.label}</label>
      {field.type === "textarea"
        ? <textarea id={field.key} required={field.required} maxLength={field.maxLength} value={fields[field.key] ?? ""} onChange={(event) => setFields({ ...fields, [field.key]: event.target.value })} />
        : field.type === "select"
          ? <select id={field.key} required={field.required} value={fields[field.key] ?? ""} onChange={(event) => setFields({ ...fields, [field.key]: event.target.value })}><option value="">Select…</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : <input id={field.key} type={field.type === "date" ? "date" : "text"} inputMode={field.type === "money" ? "decimal" : undefined} required={field.required} maxLength={field.maxLength} value={fields[field.key] ?? ""} onChange={(event) => setFields({ ...fields, [field.key]: event.target.value })} placeholder={field.type === "money" ? "400.00" : undefined} />}
    </div>)}
    <p className="notice">Review every field before signing. Theckards does not provide legal advice or handle payment between parties.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <Button busy={busy}>{busy ? "Creating preview…" : "Create preview"}</Button>
  </form>;
}
