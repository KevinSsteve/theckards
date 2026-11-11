"use client";

export default function AgreementError({ reset }: { reset: () => void }) {
  return <main id="main-content" tabIndex={-1} className="shell narrow empty-state"><p className="page-kicker">Agreement</p><h1>Agreement unavailable</h1><p>We could not load this agreement.</p><button onClick={reset}>Try again</button></main>;
}
