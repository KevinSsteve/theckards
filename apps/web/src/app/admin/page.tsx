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
  const settings = stored.map((setting) => {
    const definition = settingsRegistry.find((item) => item.key === setting.key)!;
    return { ...setting, updatedAt: setting.updatedAt.toISOString(), title: definition.title, description: definition.description };
  });
  const legal = documents.map((document) => ({ ...document, approvedAt: document.approvedAt?.toISOString() ?? null }));
  return <>
    <header className="topbar"><a className="brand" href="/admin">Theckards Admin</a><div className="actions"><span className="muted">{session.adminRole}</span><LogoutButton admin /></div></header>
    <main className="shell"><AdminDashboard settings={settings} documents={legal} events={events} role={session.adminRole!} /></main>
  </>;
}
