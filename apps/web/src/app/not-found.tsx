export const metadata = { title: "Page not found" };

/** Replaces the framework default, which had no main landmark and no way back. */
export default function NotFound() {
  return <>
    <header className="topbar"><a className="brand" href="/">Theckards</a></header>
    <main className="shell narrow">
      <h1>Page not found</h1>
      <p>This page does not exist, or the link to it is out of date.</p>
      <p className="actions">
        <a className="button" href="/">Go to the home page</a>
        <a className="button secondary" href="/verify">Verify a record</a>
      </p>
    </main>
  </>;
}
