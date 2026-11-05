import { getEnv } from "@/lib/env";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ googleMeetEnabled: getEnv().GOOGLE_MEET_ENABLED }, { headers: { "Cache-Control": "no-store" } });
}
