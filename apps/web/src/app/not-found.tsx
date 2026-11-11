import { Brand } from "./components/Brand";
import { PublicFooter } from "./components/PublicFooter";

export const metadata = { title: "Page not found" };

/** Replaces the framework default, which had no main landmark and no way back. */
export default function NotFound() {
  return <>
    <header className="topbar"><Brand /></header>
    <main id="main-content" tabIndex={-1} className="shell narrow empty-state">
      <p className="page-kicker">404</p>
      <h1>Page not found</h1>
      <p>This page does not exist, or the link to it is out of date.</p>
      <p className="actions">
        <a className="button" href="/">Go to the home page</a>
        <a className="button secondary" href="/verify">Verify a record</a>
      </p>
    </main>
    <PublicFooter />
  </>;
}
