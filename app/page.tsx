import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Workspace } from "@/components/workspace";

// The workspace is personalized from an HttpOnly session cookie. Never cache
// the dashboard response across users or requests.
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <Workspace user={user} />;
}
