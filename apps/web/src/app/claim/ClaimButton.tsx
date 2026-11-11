"use client";

import { useState } from "react";
import { Button } from "../components/Button";

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

export function ClaimButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <>
    <Button busy={busy} onClick={async () => {
      setBusy(true); setMessage("");
      try {
        const response = await fetch("/api/claim", { method: "POST", headers: { "x-csrf-token": csrf(), "idempotency-key": crypto.randomUUID() } });
        const data = await response.json().catch(() => ({})) as { agreementId?: string; detail?: string };
        if (!response.ok || !data.agreementId) { setMessage(data.detail ?? "The agreement could not be linked."); return; }
        window.location.assign(`/agreements/${data.agreementId}`);
      } catch {
        setMessage("The agreement could not be linked. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    }}>{busy ? "Linking…" : "Link to my account"}</Button>
    {message && <p className="error" role="alert">{message}</p>}
  </>;
}
