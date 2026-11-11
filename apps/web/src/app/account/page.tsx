import { redirect } from "next/navigation";
import { currentUserSession } from "../../server/auth/current";
import { userHasCurrentConsents } from "../../server/legal";
import { LogoutButton } from "../components/LogoutButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await currentUserSession();
  if (!session) redirect("/api/auth/login");
  const accepted = await userHasCurrentConsents(session.userId);
  return <>
    <header className="topbar"><a className="brand" href="/dashboard">Theckards</a><LogoutButton /></header>
    <main id="main-content" tabIndex={-1} className="shell narrow">
      <header className="page-header"><p className="page-kicker">Account</p><h1>Your account</h1><p className="lede">Legal consent and access to your agreements.</p></header>
      <div className="grid">
        <section className="card">
          <h2>Service status</h2>
          {accepted
            ? <p className="success">Your current legal documents are accepted.</p>
            : <><p className="notice">Before creating or signing an agreement, review the current legal documents.</p><a className="button" href="/legal/consent">Review and accept</a></>}
        </section>
        <section className="card"><h2>Agreements</h2>{accepted ? <a className="button" href="/dashboard">Open agreements</a> : <p className="muted">Accept the current legal documents to continue.</p>}</section>
      </div>
    </main>
  </>;
}
