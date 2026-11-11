import { redirect } from "next/navigation";
import { currentAdminSession } from "../../server/auth/current";
import { settingsRegistry } from "../../server/admin/settings-registry";
import { listAudit, listSettings } from "../../server/admin/settings";
import { listLegalDocuments } from "../../server/legal";
import { LogoutButton } from "../components/LogoutButton";
import { AdminDashboard } from "./AdminDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Theckards", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const session = await currentAdminSession();
  if (!session) redirect("/api/auth/login?intent=admin");
  const [stored, documents, events] = await Promise.all([listSettings(), listLegalDocuments(), listAudit(100)]);
  // A stored key with no entry in the registry is possible whenever a migration adds one before the image that
  // describes it is live. The dashboard is how the owner approves legal texts and turns flags off, so it shows
  // the key plainly rather than failing to render on a lookup that returns nothing.
  const settings = stored.map((setting) => {
    const definition = settingsRegistry.find((item) => item.key === setting.key);
    return {
      ...setting,
      updatedAt: setting.updatedAt.toISOString(),
      title: definition?.title ?? setting.key,
      description: definition?.description ?? "This setting is not described by the running version of Theckards.",
    };
  });
  const legal = documents.map((document) => ({ ...document, approvedAt: document.approvedAt?.toISOString() ?? null }));
  return <>
    <header className="topbar"><a className="brand" href="/admin">Theckards Admin</a><div className="actions"><span className="muted">{session.adminRole}</span><LogoutButton admin /></div></header>
    <main className="shell"><AdminDashboard settings={settings} documents={legal} events={events} role={session.adminRole!} /></main>
  </>;
}
