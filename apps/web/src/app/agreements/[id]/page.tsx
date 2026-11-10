import { redirect } from "next/navigation";
import { getAgreement } from "../../../server/agreements";
import { currentUserSession } from "../../../server/auth/current";
import { userHasCurrentConsents } from "../../../server/legal";
import { AgreementActions } from "./AgreementActions";
import { RecordPanel } from "./RecordPanel";

export const dynamic = "force-dynamic";

export default async function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentUserSession();
  if (!session) redirect("/api/auth/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) redirect("/dashboard");
  if (!(await userHasCurrentConsents(session.userId))) redirect(`/legal/consent?next=/agreements/${id}`);
  const agreement = await getAgreement(session.userId, id);
  return <>
    <header className="topbar"><a className="brand" href="/dashboard">Theckards</a><span>{agreement.state.replaceAll("_", " ")}</span></header>
    <main className="shell narrow">
      <a href="/dashboard">← Agreements</a><h1>{agreement.title}</h1>
      <p className="muted">Version {agreement.currentVersionNumber} · record revision {agreement.lockVersion}</p>
      {agreement.sections.map((section) => <section className="card" key={section.heading}><h2>{section.heading}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
      <p className="notice">Review before signing. Not legal advice. Theckards provides a verifiable record and does not handle payments between the parties.</p>
      <AgreementActions id={agreement.id} lockVersion={agreement.lockVersion} state={agreement.state} renderStatus={agreement.renderStatus}
        creatorSignedName={agreement.creatorSignedName} creatorSignedAt={agreement.creatorSignedAt}
        counterpartyName={agreement.counterpartyName} counterpartySignedName={agreement.counterpartySignedName}
        counterpartySignedAt={agreement.counterpartySignedAt} finalSealId={agreement.finalSealId} viewerIsCreator={agreement.viewerIsCreator} />
      {["EXECUTED", "COMPLETED", "IN_CASE", "RESOLVED"].includes(agreement.state) && <RecordPanel id={agreement.id} />}
    </main>
  </>;
}
