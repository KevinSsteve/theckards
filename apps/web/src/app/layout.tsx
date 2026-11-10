export const metadata = { title: "Theckards", description: "Create, sign and verify everyday agreements." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body></html>);
}
