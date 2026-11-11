import { connection } from "next/server";
import "./globals.css";

// Every page names itself and the template appends the product, so tabs, history and screen readers can tell
// pages apart (WCAG 2.4.2). A test keeps each page's title present and distinct.
export const metadata = {
  title: { default: "Theckards", template: "%s · Theckards" },
  description: "Create, sign and verify everyday agreements.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page renders per request, so its scripts carry that request's CSP nonce (src/middleware.ts). A page
  // prerendered at build time has scripts without one, and the browser would refuse to run them.
  await connection();
  return <html lang="en"><body>{children}</body></html>;
}
