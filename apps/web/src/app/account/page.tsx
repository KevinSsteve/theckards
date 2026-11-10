import { redirect } from "next/navigation";
import { currentUserSession } from "../../server/auth/current";
import { userHasCurrentConsents } from "../../server/legal";
import { LogoutButton } from "../components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await currentUserSession();
  if (!session) redirect("/api/auth/login");
  const accepted = await userHasCurrentConsents(session.userId);
  return <>
    <header className="topbar"><a className="brand" href="/">Theckards</a><LogoutButton /></header>
    <main className="shell narrow">
      <h1>Your account</h1>
      <section className="card">
        <h2>Service status</h2>
        {accepted
          ? <p className="success">Your current legal documents are accepted.</p>
          : <><p className="notice">Before creating or signing an agreement, review the current legal documents.</p><a className="button" href="/legal/consent">Review and accept</a></>}
      </section>
      <section className="card"><h2>Agreements</h2><p className="muted">Agreement creation arrives in the next delivery (S3).</p></section>
    </main>
  </>;
}
