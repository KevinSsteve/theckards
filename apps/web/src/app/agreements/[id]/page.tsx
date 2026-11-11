import { redirect } from "next/navigation";
import { getAgreement } from "../../../server/agreements";
import { currentUserSession } from "../../../server/auth/current";
import { userHasCurrentConsents } from "../../../server/legal";
import { SessionEndedNotice } from "../../components/SessionEndedNotice";
import { AgreementActions } from "./AgreementActions";
import { CasePanel } from "./CasePanel";
import { DossierPanel } from "./DossierPanel";
import { RecordPanel } from "./RecordPanel";

export const dynamic = "force-dynamic";
// Deliberately not the agreement's own title: titles land in browser history and synced tabs, and an agreement
// title often names the other person or the item.
export const metadata = { title: "Agreement" };

export default async function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentUserSession();
  if (!session) redirect("/api/auth/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) redirect("/dashboard");
  if (!(await userHasCurrentConsents(session.userId))) redirect(`/legal/consent?next=/agreements/${id}`);
  const agreement = await getAgreement(session.userId, id);
  return <>
    <header className="topbar"><a className="brand" href="/dashboard">Theckards</a><span className="status-badge" data-state={agreement.state}>{agreement.state.replaceAll("_", " ")}</span></header>
    <main id="main-content" tabIndex={-1} className="shell narrow">
      <SessionEndedNotice />
      <a className="back-link" href="/dashboard">← Agreements</a>
      <header className="page-header"><p className="page-kicker">Agreement record</p><h1>{agreement.title}</h1><p className="page-meta">Version {agreement.currentVersionNumber} · record revision {agreement.lockVersion}</p></header>
      {agreement.sections.map((section) => <section className="card agreement-section" key={section.heading}><h2>{section.heading}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
      <p className="notice">Review before signing. Not legal advice. Theckards provides a verifiable record and does not handle payments between the parties.</p>
      <AgreementActions id={agreement.id} lockVersion={agreement.lockVersion} state={agreement.state} renderStatus={agreement.renderStatus}
        creatorSignedName={agreement.creatorSignedName} creatorSignedAt={agreement.creatorSignedAt}
        counterpartyName={agreement.counterpartyName} counterpartySignedName={agreement.counterpartySignedName}
        counterpartySignedAt={agreement.counterpartySignedAt} finalSealId={agreement.finalSealId} viewerIsCreator={agreement.viewerIsCreator} />
      {["EXECUTED", "COMPLETED", "IN_CASE", "RESOLVED"].includes(agreement.state) && <RecordPanel id={agreement.id} />}
      {["EXECUTED", "IN_CASE", "RESOLVED"].includes(agreement.state) && <CasePanel id={agreement.id} />}
      {["EXECUTED", "COMPLETED", "IN_CASE", "RESOLVED"].includes(agreement.state) && <DossierPanel id={agreement.id} />}
    </main>
  </>;
}
