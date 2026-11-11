import { cookies } from "next/headers";
import { GUEST_COOKIE } from "../../../server/auth/cookies";
import { loadGuestSession } from "../../../server/auth/session-store";
import { loadInvite } from "../../../server/signing";
import { GuestActions } from "./GuestActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review agreement", robots: { index: false, follow: false } };

function Unavailable() {
  return <><header className="topbar"><a className="brand" href="/">Theckards</a></header><main id="main-content" tabIndex={-1} className="shell narrow empty-state"><p className="page-kicker">Invitation</p><h1>Link unavailable</h1>
    <p>This invitation link is invalid, expired or was already used. Ask the person who invited you to send a new invitation.</p></main></>;
}

export default async function GuestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await loadInvite(token);
  if (!invite) return <Unavailable />;
  const jar = await cookies();
  const guest = await loadGuestSession(jar.get(GUEST_COOKIE)?.value);
  const ownsSession = guest?.partyId === invite.partyId;
  const usable = !invite.consumed && !!invite.expiresAt && invite.expiresAt.getTime() > Date.now();
  if (!usable && !ownsSession) return <Unavailable />;

  return <>
    <header className="topbar"><a className="brand" href="/">Theckards</a><span className="status-badge" data-state={invite.state}>{invite.state.replaceAll("_", " ")}</span></header>
    <main id="main-content" tabIndex={-1} className="shell narrow">
      <header className="page-header">
        <p className="page-kicker">Invitation for {invite.displayName}</p>
        <h1>{invite.title}</h1>
        <p className="page-meta">Version {invite.versionNumber}{invite.creatorSignedName ? ` · signed by ${invite.creatorSignedName}` : ""}</p>
      </header>
      <p className="notice">Review before signing. Not legal advice. Theckards provides a verifiable record. It does not certify identity, hold funds or guarantee payment.</p>
      {invite.sections.map((section) => <section className="card agreement-section" key={section.heading}><h2>{section.heading}</h2>{section.paragraphs.map((p) => <p key={p}>{p}</p>)}</section>)}
      <GuestActions token={token} usable={usable} askEmail={invite.channel === "LINK"} signedAt={invite.counterpartySignedAt?.toISOString() ?? null}
        state={invite.state} finalAvailable={ownsSession && !!invite.finalSealId} renderReady={invite.renderStatus === "READY"} />
    </main>
  </>;
}
