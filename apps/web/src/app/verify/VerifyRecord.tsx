"use client";

import { createSHA256 } from "hash-wasm";
import { useState } from "react";

interface Verification {
  valid: boolean;
  kind: "FINAL" | "ADDENDUM" | "DOSSIER" | null;
  sealed_at: string | null;
  seal_id: string | null;
  anchored: boolean;
}

const CHUNK_BYTES = 4 * 1024 * 1024;

/** Incremental SHA-256 in the browser. No file bytes are sent over the network. */
export async function hashFileLocally(file: File): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    hasher.update(new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer()));
  }
  return hasher.digest("hex");
}

export function VerifyRecord({ expectedSeal }: { expectedSeal: string | null }) {
  const [digest, setDigest] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Verification | null>(null);

  async function verify(value: string) {
    const normalized = value.trim().toLowerCase();
    setBusy(true); setMessage(""); setResult(null);
    try {
      const response = await fetch(`/api/public/verify/${encodeURIComponent(normalized || "-")}`);
      if (!response.ok) throw new Error("request failed");
      setDigest(normalized);
      setResult(await response.json() as Verification);
    } catch {
      setMessage("Verification is temporarily unavailable. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  const sealMatches = !!result?.valid && (!expectedSeal || result.seal_id?.toLowerCase() === expectedSeal);
  return <section className="card">
    <h2>Choose what to verify</h2>
    <label htmlFor="verify-file">PDF file (stays on this device)</label>
    <input id="verify-file" type="file" accept="application/pdf,.pdf" disabled={busy} onChange={async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setBusy(true); setMessage("Computing SHA-256 locally…"); setResult(null);
      try {
        const hash = await hashFileLocally(file);
        setMessage("");
        await verify(hash);
      } catch {
        setMessage("This browser could not read the selected file."); setBusy(false);
      }
    }} />
    <p className="muted">or</p>
    <form onSubmit={(event) => { event.preventDefault(); void verify(digest); }}>
      <label htmlFor="verify-hash">SHA-256</label>
      <input id="verify-hash" className="code" spellCheck={false} autoComplete="off" placeholder="64 hexadecimal characters" value={digest} disabled={busy} onChange={(event) => setDigest(event.target.value)} />
      <button disabled={busy}>{busy ? "Checking…" : "Verify hash"}</button>
    </form>
    {message && <p className={message.includes("unavailable") || message.includes("could not") ? "error" : "muted"} role="status">{message}</p>}
    {result && sealMatches && <div className="notice" role="status">
      <h3>Valid Theckards seal</h3>
      <dl>
        <dt>Kind</dt><dd>{result.kind}</dd>
        <dt>Sealed at</dt><dd>{result.sealed_at ? new Date(result.sealed_at).toUTCString() : ""}</dd>
        <dt>Seal ID</dt><dd><code>{result.seal_id}</code></dd>
        <dt>Blockchain anchor</dt><dd>{result.anchored ? "Anchored" : "Not anchored"}</dd>
      </dl>
      <p className="muted">SHA-256: <code>{digest}</code></p>
    </div>}
    {result && !sealMatches && <div className="notice" role="status">
      <h3>No matching seal</h3>
      <p>This hash does not match the expected Theckards seal. Check that you selected the original sealed PDF.</p>
      {digest && <p className="muted">Computed SHA-256: <code>{digest}</code></p>}
    </div>}
  </section>;
}
