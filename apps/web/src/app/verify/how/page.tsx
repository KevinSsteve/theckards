import { Brand } from "../../components/Brand";
import { PublicFooter } from "../../components/PublicFooter";

export const metadata = { title: "How to verify offline" };

export default function HowToVerifyPage() {
  return <>
    <header className="topbar"><Brand /><a href="/verify">Verify a file</a></header>
    <main id="main-content" tabIndex={-1} className="shell narrow">
      <header className="page-header"><p className="page-kicker">Independent verification</p><h1>How to verify a receipt offline</h1><p className="lede">You need the sealed file, its <code>.receipt.json</code> sidecar, and the Theckards public key whose ID matches <code>key_id</code> in the receipt.</p></header>
      <ol className="instruction-list">
        <li><span className="instruction-number" aria-hidden="true">1</span><div><strong>Hash the file.</strong> Run <code>sha256sum sealed.pdf</code> (or the equivalent on your system) and confirm the result equals <code>sha256</code> in the receipt.</div></li>
        <li><span className="instruction-number" aria-hidden="true">2</span><div><strong>Get the public key.</strong> Download <a href="/.well-known/theckards-keys.json">the published key set</a> and select the key matching the receipt's <code>key_id</code>. Save its <code>public_key_pem</code> as <code>public.pem</code>.</div></li>
        <li><span className="instruction-number" aria-hidden="true">3</span><div><strong>Rebuild the signed payload.</strong> RFC 8785-canonicalize exactly <code>{`{id, kind, sha256, content_sha256, sealed_at}`}</code> from the receipt, encode it as UTF-8, and save it as <code>payload.json</code>.</div></li>
        <li><span className="instruction-number" aria-hidden="true">4</span><div><strong>Decode the signature.</strong> Base64-decode <code>signature</code> from the receipt into <code>signature.der</code>.</div></li>
        <li><span className="instruction-number" aria-hidden="true">5</span><div><strong>Verify ECDSA P-256/SHA-256.</strong> Run <code>openssl dgst -sha256 -verify public.pem -signature signature.der payload.json</code>. A valid signature reports <code>Verified OK</code>.</div></li>
      </ol>
      <section className="card agreement-section" id="impression">
        <h2>The seal impression</h2>
        <p>Every sealed document prints a circular mark beside its verification QR code. The mark is derived from the
        seal identifier alone, so the same seal always presses the same impression and two different documents never
        share one. It lets a person compare a printed copy with what the verification page shows, the way a wax seal
        was compared by eye.</p>
        <p>The impression is a convenience, not the proof: the proof is the hash and the signature described above.
        Records sealed before impressions were introduced verify normally but carry no printed mark, because a sealed
        file is never regenerated once it exists.</p>
      </section>
      <section className="card agreement-section">
        <h2>What this proves</h2>
        <p>The file hash proves that your copy has not changed since sealing. The ECDSA signature proves that Theckards issued the receipt with the identified key. Neither check proves the truth of the content, anyone's civil identity, legal validity, performance or payment.</p>
      </section>
    </main>
    <PublicFooter />
  </>;
}
