import { redirect } from "next/navigation";
import { currentUserSession } from "../../../server/auth/current";
import { currentApprovedLegal } from "../../../server/legal";
import { ConsentForm } from "./ConsentForm";
import { LegalText } from "../../components/LegalText";

export const dynamic = "force-dynamic";

export default async function LegalConsentPage() {
  const session = await currentUserSession();
  if (!session) redirect("/api/auth/login");
  const documents = await currentApprovedLegal();
  return <main className="shell narrow">
    <a className="brand" href="/">Theckards</a>
    <h1>Review before continuing</h1>
    {documents.length === 0
      ? <section className="notice"><h2>Legal review pending</h2><p>The owner has not approved the production legal documents. Registration and signing remain blocked.</p></section>
      : <>{documents.map((document) => <article className="card" key={document.id}><p className="muted">Version {document.version} · {document.documentType}</p><LegalText markdown={document.bodyMd} /></article>)}<ConsentForm /></>}
  </main>;
}
