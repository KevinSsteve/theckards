"use client";

export default function AgreementError({ reset }: { reset: () => void }) {
  return <main className="shell narrow"><h1>Agreement unavailable</h1><p>We could not load this agreement.</p><button onClick={reset}>Try again</button></main>;
}
