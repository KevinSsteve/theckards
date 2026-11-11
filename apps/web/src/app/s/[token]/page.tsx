import { cookies } from "next/headers";
import { DEVICE_COOKIE, GUEST_COOKIE } from "../../../server/auth/cookies";
import { loadGuestSession } from "../../../server/auth/session-store";
import { counterpartyView, loadInPersonByToken } from "../../../server/in-person";
import { finalDocumentFor } from "../../../server/signing";
import { InPersonSigner } from "./InPersonSigner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in person", robots: { index: false, follow: false }, referrer: "no-referrer" };

function Unavailable() {
  return <><header className="topbar"><a className="brand" href="/">Theckards</a></header><main id="main-content" tabIndex={-1} className="shell narrow empty-state"><p className="page-kicker">In-person signing</p><h1>QR code unavailable</h1>
    <p>This QR code is invalid, expired or was already used on another device. Ask the other party to show a new QR code.</p></main></>;
}

export default async function InPersonPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await loadInPersonByToken(token);
  const jar = await cookies();
  const sealed = context?.status === "COMPLETED" ? !!(await finalDocumentFor(context.agreementId)) : false;
  const view = counterpartyView(context, jar.get(DEVICE_COOKIE)?.value, sealed);
  if (!context || view.status === "UNAVAILABLE") return <Unavailable />;
  const guest = await loadGuestSession(jar.get(GUEST_COOKIE)?.value);
  const hasDownloadSession = !!guest && guest.partyId === context.partyId;

  return <>
    <header className="topbar"><a className="brand" href="/">Theckards</a><span className="status-badge">Signing in person</span></header>
    <main id="main-content" tabIndex={-1} className="shell narrow">
      <header className="page-header"><p className="page-kicker">Review and sign</p><h1>{context.title}</h1><p className="page-meta">Version {context.versionNumber}{context.creatorSignedName ? ` · already signed by ${context.creatorSignedName}` : ""}</p></header>
      <p className="notice">Review before signing. Not legal advice. Theckards provides a verifiable record. It does not certify identity, hold funds or guarantee payment.</p>
      {view.status !== "COMPLETED" && <>
        {context.sections.map((section) => <section className="card agreement-section" key={section.heading}><h2>{section.heading}</h2>{section.paragraphs.map((p) => <p key={p}>{p}</p>)}</section>)}
        <p><a className="button secondary" href={`/api/in-person/${encodeURIComponent(token)}/preview`} target="_blank" rel="noreferrer">Open the exact PDF you are signing</a></p>
      </>}
      <InPersonSigner token={token} initial={view} hasDownloadSession={hasDownloadSession} />
    </main>
  </>;
}
