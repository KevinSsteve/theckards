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
    <header className="topbar"><a className="brand" href="/dashboard">Theckards</a><nav className="actions"><a href="/account">Account</a><LogoutButton /></nav></header>
    <main className="shell">
      <div className="actions spread"><div><h1>Agreements</h1><p className="muted">Your records, signatures and next dates.</p></div><a className="button" href="/agreements/new">New agreement</a></div>
      {agreements.length === 0
        ? <section className="card"><h2>No agreements yet</h2><p>Start with a guided template. You can review every field before sending anything.</p><a className="button" href="/agreements/new">Create your first agreement</a></section>
        : <div className="grid">{agreements.map((agreement) => <a className="card card-link" href={`/agreements/${agreement.id}`} key={agreement.id}><strong>{agreement.title}</strong><p>{agreement.state.replaceAll("_", " ")}</p><p className="muted">{agreement.templateId.replaceAll("_", " ")} · preview {agreement.renderStatus.toLowerCase()}</p></a>)}</div>}
    </main>
  </>;
}
