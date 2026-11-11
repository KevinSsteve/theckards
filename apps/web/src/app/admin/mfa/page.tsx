import { redirect } from "next/navigation";
import { currentUserSession } from "../../../server/auth/current";
import { requirePendingAdmin } from "../../../server/auth/session-store";
import { MfaSetup } from "./MfaSetup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up MFA", robots: { index: false, follow: false } };

export default async function AdminMfaPage() {
  const session = await currentUserSession();
  if (!session) redirect("/api/auth/login?intent=admin");
  try { await requirePendingAdmin(session); } catch { redirect("/"); }
  return <>
    <header className="topbar"><a className="brand" href="/">Theckards Admin</a><span className="status-badge">MFA required</span></header>
    <main id="main-content" tabIndex={-1} className="shell narrow"><header className="page-header"><p className="page-kicker">Secure access</p><h1>Administrator MFA</h1><p className="lede">Administrators must use a TOTP authenticator before the Admin dashboard opens.</p></header><MfaSetup /></main>
  </>;
}
