export const metadata = { title: "How to verify offline · Theckards" };

export default function HowToVerifyPage() {
  return <>
    <header className="topbar"><a className="brand" href="/">Theckards</a><a href="/verify">Verify a file</a></header>
    <main className="shell narrow">
      <h1>How to verify a receipt offline</h1>
      <p>You need the sealed file, its <code>.receipt.json</code> sidecar, and the Theckards public key whose ID matches <code>key_id</code> in the receipt.</p>
      <ol>
        <li><strong>Hash the file.</strong> Run <code>sha256sum sealed.pdf</code> (or the equivalent on your system) and confirm the result equals <code>sha256</code> in the receipt.</li>
        <li><strong>Get the public key.</strong> Download <a href="/.well-known/theckards-keys.json">the published key set</a> and select the key matching the receipt's <code>key_id</code>. Save its <code>public_key_pem</code> as <code>public.pem</code>.</li>
        <li><strong>Rebuild the signed payload.</strong> RFC 8785-canonicalize exactly <code>{`{id, kind, sha256, content_sha256, sealed_at}`}</code> from the receipt, encode it as UTF-8, and save it as <code>payload.json</code>.</li>
        <li><strong>Decode the signature.</strong> Base64-decode <code>signature</code> from the receipt into <code>signature.der</code>.</li>
        <li><strong>Verify ECDSA P-256/SHA-256.</strong> Run <code>openssl dgst -sha256 -verify public.pem -signature signature.der payload.json</code>. A valid signature reports <code>Verified OK</code>.</li>
      </ol>
      <section className="card">
        <h2>What this proves</h2>
        <p>The file hash proves that your copy has not changed since sealing. The ECDSA signature proves that Theckards issued the receipt with the identified key. Neither check proves the truth of the content, anyone's civil identity, legal validity, performance or payment.</p>
      </section>
    </main>
  </>;
}
