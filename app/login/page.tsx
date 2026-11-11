"use client";

import Link from "next/link";
import { useState } from "react";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { auth, firebaseConfigured } from "@/lib/firebase/client";
import { PhoneCall } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupToken, setSetupToken] = useState("");
  const [workspace, setWorkspace] = useState({ companyName: "", ownerName: "" });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!auth) {
      setError("Firebase web settings are missing from this build. Add the NEXT_PUBLIC_FIREBASE_* variables to your deployment environment and rebuild, or configure .env.local for local development.");
      return;
    }
    setBusy(true);
    try {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await credential.user.getIdToken(true);
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, remember }),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          `Login service returned an unexpected response (HTTP ${response.status}). Restart the app and try again.`,
        );
      }
      const data = await response.json();
      if (response.status === 403 && data.error?.includes("not linked to a workspace")) {
        let saved = { companyName: "", ownerName: credential.user.displayName || "" };
        try {
          const pending = localStorage.getItem("pendingOrganization");
          if (pending) saved = { ...saved, ...JSON.parse(pending) };
        } catch {
          // Let the user enter the workspace details below if saved data is invalid.
        }
        setWorkspace(saved);
        setSetupToken(idToken);
        setError("Your Firebase account is valid, but workspace setup is incomplete. Enter your workspace details below to finish.");
        setBusy(false);
        return;
      }
      if (!response.ok) throw new Error(data.error || "Could not create a session");
      location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
      setBusy(false);
    }
  };
  const finishWorkspaceSetup = async () => {
    setError("");
    setBusy(true);
    try {
      const setupResponse = await fetch("/api/organization/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...workspace, idToken: setupToken }),
      });
      const setupData = await setupResponse.json();
      if (!setupResponse.ok) throw new Error(setupData.error || "Could not create workspace");
      localStorage.removeItem("pendingOrganization");
      const sessionResponse = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: setupToken, remember }),
      });
      const sessionData = await sessionResponse.json();
      if (!sessionResponse.ok) throw new Error(sessionData.error || "Workspace created, but sign-in did not finish");
      location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish workspace setup");
      setBusy(false);
    }
  };
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-2">
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-[420px]">
          <Link href="/login" className="mb-12 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white">
              <PhoneCall size={19} />
            </span>
            <span className="text-lg font-semibold">
              human<span className="text-brand">dialer</span>
            </span>
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm text-slate-500">
            Sign in to your workspace and get connected.
          </p>
          <form onSubmit={submit} className="mt-8 space-y-5">
            <label className="block text-sm font-medium">
              Work email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-brand"
                placeholder="you@company.com"
              />
            </label>
            <label className="block text-sm font-medium">
              Password
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-brand"
                placeholder="Enter your password"
              />
            </label>
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-slate-500">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="accent-brand"
                />{" "}
                Remember me
              </label>
              <Link href="/forgot-password" className="font-semibold text-brand">
                Forgot password?
              </Link>
            </div>
            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {setupToken && (
              <div className="space-y-3 rounded-lg border border-slate-200 p-4">
                <label className="block text-sm font-medium">
                  Company name
                  <input required minLength={2} value={workspace.companyName} onChange={(e) => setWorkspace({ ...workspace, companyName: e.target.value })} className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3" />
                </label>
                <label className="block text-sm font-medium">
                  Your name
                  <input required minLength={2} value={workspace.ownerName} onChange={(e) => setWorkspace({ ...workspace, ownerName: e.target.value })} className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3" />
                </label>
                <button type="button" disabled={busy} onClick={() => void finishWorkspaceSetup()} className="h-10 w-full rounded-lg bg-brand font-semibold text-white disabled:opacity-60">
                  {busy ? "Setting up…" : "Finish workspace setup"}
                </button>
              </div>
            )}
            <button
              disabled={busy}
              className="h-11 w-full rounded-lg bg-brand font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">
            Need a new workspace?{" "}
            <Link href="/register" className="font-semibold text-brand">
              Register your organization
            </Link>
            <span className="mt-2 block text-xs text-slate-400">Employee accounts are created by your organization owner.</span>
          </p>
          {!firebaseConfigured && (
            <p className="mt-5 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              Firebase web settings are missing from this build. Set the NEXT_PUBLIC_FIREBASE_* variables in Render and redeploy, or add them to .env.local for local development.
            </p>
          )}
        </div>
      </section>
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#17152f] p-12 text-white lg:flex">
        <div className="absolute -right-20 -top-20 h-[430px] w-[430px] rounded-full border border-white/10" />
        <div className="absolute -right-4 top-16 h-[290px] w-[290px] rounded-full border border-white/10" />
        <div className="relative self-end rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-400/20 text-emerald-300">
              <PhoneCall size={18} />
            </div>
            <div>
              <div className="text-sm font-medium">Call connected</div>
              <div className="text-xs text-white/50">With Maya Chen · 04:32</div>
            </div>
          </div>
          <div className="h-10 w-[250px] rounded-lg bg-gradient-to-r from-indigo-400/0 via-indigo-400/60 to-emerald-300/0 opacity-80" />
          <div className="mt-4 flex justify-center gap-2">
            <i className="h-8 w-8 rounded-full bg-white/10" />
            <i className="h-8 w-8 rounded-full bg-red-400" />
            <i className="h-8 w-8 rounded-full bg-white/10" />
          </div>
        </div>
        <div className="relative max-w-md">
          <div className="mb-4 text-xs font-semibold uppercase tracking-[.2em] text-indigo-300">
            Meaningful conversations start here
          </div>
          <div className="text-4xl font-semibold leading-tight">
            Every good relationship begins with a hello.
          </div>
          <p className="mt-5 leading-7 text-white/55">
            A thoughtful calling workspace for the people who bring your business to life.
          </p>
        </div>
        <div className="relative text-xs text-white/35">© 2026 Ancentrix Dial</div>
      </aside>
    </main>
  );
}
