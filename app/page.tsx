import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Workspace } from "@/components/workspace";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <Workspace user={user} />;
}
