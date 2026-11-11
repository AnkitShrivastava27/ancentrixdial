import "server-only";
import { db } from "@/lib/firebase/admin";
import type { SessionUser } from "@/lib/auth";

export async function recordActivity(user: SessionUser, action: string, details: Record<string, string | number | boolean> = {}) {
  if (!db) return;
  await db.collection("activity_logs").add({ organizationId: user.organizationId, userId: user.uid, userName: user.name, action, details, createdAt: new Date() });
}
