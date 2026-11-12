import type { Metadata } from "next";
import { PAGE_CLASS, PageHeader } from "@/components/page-header";
import { PrivacySettings } from "@/features/privacy/components/privacy-settings";
import { getMyGuardAction } from "@/features/privacy/server/actions";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Calendar privacy" };

/** The signed-in user's own calendar privacy: whether it is on, and who may schedule for them. */
export default async function CalendarPrivacyPage() {
  await requireUser();
  const guard = await getMyGuardAction();

  return (
    <div className={`${PAGE_CLASS} max-w-3xl`}>
      <PageHeader
        title="Calendar privacy"
        description="Keep your calendar private in Keel Calendar, so only you and the people you name can see or schedule it."
      />
      <PrivacySettings guard={guard} />
    </div>
  );
}
