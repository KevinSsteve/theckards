import { templateDefinitions } from "@theckards/domain";
import { redirect } from "next/navigation";
import { currentUserSession } from "../../../server/auth/current";
import { userHasCurrentConsents } from "../../../server/legal";
import { NewAgreementForm } from "./NewAgreementForm";

export const dynamic = "force-dynamic";

export default async function NewAgreementPage() {
  const session = await currentUserSession();
  if (!session) redirect("/api/auth/login");
  if (!(await userHasCurrentConsents(session.userId))) redirect("/legal/consent");
  return <main className="shell narrow"><a href="/dashboard">← Agreements</a><h1>New agreement</h1><p>Choose a template and enter only the facts the agreement needs.</p><NewAgreementForm templates={Object.values(templateDefinitions)} /></main>;
}
