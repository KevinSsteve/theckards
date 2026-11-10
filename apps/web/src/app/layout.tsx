import "./globals.css";

export const metadata = { title: "Theckards", description: "Create, sign and verify everyday agreements." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
