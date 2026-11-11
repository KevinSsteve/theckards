import { templateDefinitions } from "@theckards/domain";
import { Brand } from "../../components/Brand";
import { redirect } from "next/navigation";
import { currentUserSession } from "../../../server/auth/current";
import { userHasCurrentConsents } from "../../../server/legal";
import { NewAgreementForm } from "./NewAgreementForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "New agreement" };

export default async function NewAgreementPage() {
  const session = await currentUserSession();
  if (!session) redirect("/api/auth/login");
  if (!(await userHasCurrentConsents(session.userId))) redirect("/legal/consent");
  return <>
    <header className="topbar"><Brand href="/dashboard" /></header>
    <main id="main-content" tabIndex={-1} className="shell narrow">
      <a className="back-link" href="/dashboard">← Agreements</a>
      <header className="page-header"><p className="page-kicker">New record</p><h1>New agreement</h1><p className="lede">Choose a template and enter only the facts the agreement needs.</p></header>
      <NewAgreementForm templates={Object.values(templateDefinitions)} />
    </main>
  </>;
}
