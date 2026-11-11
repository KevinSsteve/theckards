import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GUEST_COOKIE } from "../../server/auth/cookies";
import { currentUserSession } from "../../server/auth/current";
import { loadGuestSession } from "../../server/auth/session-store";
import { claimPreview } from "../../server/record";
import { ClaimButton } from "./ClaimButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Keep access", robots: { index: false, follow: false } };

export default async function ClaimPage() {
  const session = await currentUserSession();
  if (!session) redirect("/api/auth/login?next=/claim");
  const guest = await loadGuestSession((await cookies()).get(GUEST_COOKIE)?.value);
  const preview = guest ? await claimPreview(session.userId, guest).catch(() => null) : null;
  return <>
    <header className="topbar"><a className="brand" href="/dashboard">Theckards</a></header>
    <main className="shell narrow">
      <h1>Keep access to your agreement</h1>
      {!preview && <section className="card"><p>There is nothing to link on this device. Open this page on the phone you signed with, within 2 hours of signing.</p><a className="button secondary" href="/dashboard">Go to your agreements</a></section>}
      {preview?.status === "AVAILABLE" && <section className="card">
        <p>Link <strong>{preview.title}</strong> to this Theckards account. You will be able to see the record, download the sealed PDF, and declare confirmations later from any device.</p>
        <ClaimButton />
      </section>}
      {preview?.status === "LINKED" && <section className="card"><p className="success">This agreement is already linked to your account.</p><a className="button" href={`/agreements/${preview.agreementId}`}>Open agreement</a></section>}
      {preview?.status === "CREATOR" && <section className="card"><p className="error">You created this agreement, so this account cannot also be the counterparty. Sign in with the counterparty's own account.</p></section>}
      {preview?.status === "TAKEN" && <section className="card"><p className="error">This agreement is already linked to another account.</p></section>}
    </main>
  </>;
}
