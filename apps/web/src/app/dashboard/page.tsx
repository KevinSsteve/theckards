import { redirect } from "next/navigation";
import { listAgreements } from "../../server/agreements";
import { currentUserSession } from "../../server/auth/current";
import { userHasCurrentConsents } from "../../server/legal";
import { LogoutButton } from "../components/LogoutButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agreements" };

export default async function DashboardPage() {
  const session = await currentUserSession();
  if (!session) redirect("/api/auth/login");
  if (!(await userHasCurrentConsents(session.userId))) redirect("/legal/consent?next=/dashboard");
  const agreements = await listAgreements(session.userId);
  return <>
    <header className="topbar"><a className="brand" href="/dashboard">Theckards</a><nav className="actions" aria-label="Account"><a href="/account">Account</a><LogoutButton /></nav></header>
    <main id="main-content" tabIndex={-1} className="shell">
      <header className="page-header page-header-row">
        <div><p className="page-kicker">Your workspace</p><h1>Agreements</h1><p className="lede">Your records, signatures and next dates.</p></div>
        <a className="button" href="/agreements/new">New agreement</a>
      </header>
      {agreements.length === 0
        ? <section className="card empty-state"><h2>No agreements yet</h2><p>Start with a guided template. You can review every field before sending anything.</p><a className="button" href="/agreements/new">Create your first agreement</a></section>
        : <div className="grid">{agreements.map((agreement) => <a className="card card-link" href={`/agreements/${agreement.id}`} key={agreement.id}>
            <strong className="agreement-card-title">{agreement.title}</strong>
            <p className="agreement-card-status"><span className="status-badge" data-state={agreement.state}>{agreement.state.replaceAll("_", " ")}</span></p>
            <p className="muted agreement-card-meta">{agreement.templateId.replaceAll("_", " ")} · preview {agreement.renderStatus.toLowerCase()}</p>
          </a>)}</div>}
    </main>
  </>;
}
