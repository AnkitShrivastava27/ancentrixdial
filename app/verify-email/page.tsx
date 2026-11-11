"use client";

import { useEffect, useState } from "react";
import { applyActionCode } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

export default function VerifyEmail() {
  const [message, setMessage] = useState("Verifying your email…");
  useEffect(() => {
    const run = async () => {
      if (!auth) return setMessage("Firebase is not configured.");
      const query = new URLSearchParams(location.search);
      const code = query.get("oobCode");
      try {
        if (code) await applyActionCode(auth, code);
        await auth.currentUser?.reload();
        const user = auth.currentUser;
        if (!user?.emailVerified)
          return setMessage("Email verified. Sign in from this browser to finish account setup.");
        const saved = localStorage.getItem("pendingOrganization");
        if (saved) {
          const data = JSON.parse(saved);
          const response = await fetch("/api/organization/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...data, idToken: await user.getIdToken(true) }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Workspace setup failed");
          localStorage.removeItem("pendingOrganization");
        }
        const session = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: await user.getIdToken(true) }),
        });
        if (!session.ok) throw new Error("Sign in to finish setting up your workspace.");
        location.href = "/";
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not verify email");
      }
    };
    void run();
  }, []);
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-5">
      <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-soft">
        <h1 className="text-xl font-semibold">Email verification</h1>
        <p className="mt-3 text-sm text-slate-600">{message}</p>
        <a href="/login" className="mt-5 inline-block font-semibold text-brand">
          Go to sign in
        </a>
      </div>
    </main>
  );
}
