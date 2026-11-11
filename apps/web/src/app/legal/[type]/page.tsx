import { notFound } from "next/navigation";
import { currentApprovedLegal } from "../../../server/legal";
import { LegalText } from "../../components/LegalText";
import { PublicFooter } from "../../components/PublicFooter";

export const dynamic = "force-dynamic";

const TYPES = { terms: "TERMS", privacy: "PRIVACY", esign: "ESIGN", notice: "NOTICE" } as const;

/** Fixed names, not the stored titles, so the title needs no database read and a draft can never set it. */
const TITLES: Record<keyof typeof TYPES, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
  esign: "Electronic Records and Signature Consent",
  notice: "Important Notice",
};

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  return { title: TITLES[type as keyof typeof TYPES] ?? "Legal" };
}

export default async function LegalDocumentPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const documentType = TYPES[type as keyof typeof TYPES];
  if (!documentType) notFound();
  const document = (await currentApprovedLegal()).find((d) => d.documentType === documentType);
  return <>
    <header className="topbar"><a className="brand" href="/">Theckards</a><a href="/verify">Verify a record</a></header>
    <main id="main-content" tabIndex={-1} className="shell narrow">
      {document
        ? <><p className="muted legal-document-meta">Version {document.version}{document.approvedAt ? ` · effective ${document.approvedAt.toISOString().slice(0, 10)}` : ""}</p><LegalText markdown={document.bodyMd} /></>
        : <section className="empty-state"><p className="page-kicker">Legal document</p><h1>Pending approval</h1><p>This document has not been published yet. Registration and signing stay closed until it is approved.</p></section>}
    </main>
    <PublicFooter />
  </>;
}
