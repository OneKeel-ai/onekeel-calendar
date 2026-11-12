import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { AdminGuards } from "@/features/privacy/components/admin-guards";
import { listGuardsAction } from "@/features/privacy/server/actions";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Private calendars" };

/** Instance admin: every private calendar, and protecting one before that person first signs in. */
export default async function AdminPrivacyPage() {
  await requireAdmin();
  const guards = await listGuardsAction();

  return (
    <>
      <PageHeader
        title="Private calendars"
        description="People who keep their calendar private. You can set this up for someone before they first sign in; after that, only they can change it."
      />
      <AdminGuards guards={guards} />
    </>
  );
}
