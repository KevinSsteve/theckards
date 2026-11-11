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
  return <main className="shell narrow"><h1>Administrator MFA</h1><p>Administrators must use a TOTP authenticator before the Admin dashboard opens.</p><MfaSetup /></main>;
}
