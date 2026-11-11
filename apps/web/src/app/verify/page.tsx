import { PublicFooter } from "../components/PublicFooter";
import { VerifyRecord } from "./VerifyRecord";

export const metadata = { title: "Verify a record", description: "Check whether a PDF matches a Theckards integrity seal without uploading the file." };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ seal?: string }> }) {
  const { seal } = await searchParams;
  const expectedSeal = seal && /^[0-9a-f-]{36}$/i.test(seal) ? seal.toLowerCase() : null;
  return <>
    <header className="topbar"><a className="brand" href="/">Theckards</a><a href="/verify/how">How to verify offline</a></header>
    <main id="main-content" tabIndex={-1} className="shell narrow">
      <header className="page-header"><p className="page-kicker">Public verification</p><h1>Verify a Theckards record</h1><p className="lede">Select a PDF or paste its SHA-256. Your browser computes the hash locally. The PDF is never uploaded to Theckards.</p></header>
      {expectedSeal && <p className="notice">This verification was opened for seal <code>{expectedSeal}</code>. Select the PDF and we will also confirm that it belongs to this seal.</p>}
      <VerifyRecord expectedSeal={expectedSeal} />
      <section className="card agreement-section">
        <h2>What verification means</h2>
        <p>A match shows that the file is byte-for-byte the file Theckards sealed at the time shown. It does not prove that the agreement content is true, certify anyone's identity, guarantee performance or payment, or provide legal advice.</p>
      </section>
    </main>
    <PublicFooter />
  </>;
}
