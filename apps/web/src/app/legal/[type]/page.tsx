import { notFound } from "next/navigation";
import { currentApprovedLegal } from "../../../server/legal";
import { LegalText } from "../../components/LegalText";

export const dynamic = "force-dynamic";

const TYPES = { terms: "TERMS", privacy: "PRIVACY", esign: "ESIGN", notice: "NOTICE" } as const;

export default async function LegalDocumentPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const documentType = TYPES[type as keyof typeof TYPES];
  if (!documentType) notFound();
  const document = (await currentApprovedLegal()).find((d) => d.documentType === documentType);
  return <main className="shell narrow">
    <a className="brand" href="/">Theckards</a>
    {document
      ? <><p className="muted">Version {document.version}{document.approvedAt ? ` · effective ${document.approvedAt.toISOString().slice(0, 10)}` : ""}</p><LegalText markdown={document.bodyMd} /></>
      : <><h1>Pending approval</h1><p>This document has not been published yet. Registration and signing stay closed until it is approved.</p></>}
  </main>;
}
