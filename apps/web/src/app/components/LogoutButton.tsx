"use client";

import { useState } from "react";
import { Button } from "./Button";

function csrf(): string {
  const part = document.cookie.split("; ").find((item) => item.startsWith("__Host-theckards_csrf="));
  return part ? decodeURIComponent(part.split("=")[1] ?? "") : "";
}

export function LogoutButton({ admin = false }: { admin?: boolean }) {
  const [busy, setBusy] = useState(false);
  return <Button className="secondary" busy={busy} onClick={async () => {
    setBusy(true);
    const response = await fetch(admin ? "/api/auth/admin-logout" : "/api/auth/logout", { method: "POST", headers: { "x-csrf-token": csrf() } });
    const body = await response.json() as { logoutUrl?: string };
    window.location.assign(body.logoutUrl ?? "/");
  }}>{busy ? "Signing out…" : "Sign out"}</Button>;
}
