"use client";

import { useEffect, useState } from "react";
import {
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useQuery } from "@tanstack/react-query";
import {
  MailPlus,
  ShieldCheck,
  Users,
  Phone,
  Save,
  UserRound,
  KeyRound,
  Power,
  Trash2,
  Copy,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth";
export function SettingsView({ user }: { user: SessionUser }) {
  const [tab, setTab] = useState(user.role === "owner" ? "Team" : "Profile");
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || "");
  const [company, setCompany] = useState("");
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({ name: "", email: "", password: "" });
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);
  const [sip, setSip] = useState({
    voiceAppId: "",
    outboundNumber: "",
    apiKey: "",
  });
  const [notice, setNotice] = useState("");
  const [reauth, setReauth] = useState(false);
  const [pendingTab, setPendingTab] = useState("");
  const [password, setPassword] = useState("");
  const [reauthToken, setReauthToken] = useState("");
  const team = useQuery({
    queryKey: ["team"],
    queryFn: async () => {
      const r = await fetch("/api/users");
      return r.ok ? r.json() : [];
    },
    enabled: user.role === "owner" && tab === "Team",
  });
  useEffect(() => {
    fetch("/api/organizations/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCompany(d.name || ""))
      .catch(() => {});
  }, []);
  const createEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(employeeForm),
    });
    const d = await r.json();
    setNotice(
      r.ok
        ? `Employee account created for ${d.email}. Share the initial password securely.`
        : d.error,
    );
    if (r.ok) {
      setCreatedCredentials({ email: d.email, password: employeeForm.password });
      setShowEmployeeForm(false);
      setEmployeeForm({ name: "", email: "", password: "" });
      team.refetch();
    }
  };
  const saveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reauthToken) {
      setReauth(true);
      return;
    }
    try {
      const r = await fetch("/api/telnyx/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-reauth-token": reauthToken },
        body: JSON.stringify(sip),
      });
      const responseText = await r.text();
      let data: { ok?: boolean; error?: string } = {};
      try { data = responseText ? JSON.parse(responseText) as { ok?: boolean; error?: string } : {}; } catch { /* handled below */ }
      if (r.ok && data.ok) {
        setNotice("Telnyx settings saved. Calls will ring the employee phone, then dial and bridge the selected contact.");
      } else {
        setNotice(data.error || `The server returned an empty or invalid response while saving Telnyx settings (HTTP ${r.status}). Check the server logs.`);
      }
    } catch {
      setNotice("Could not reach the server while saving Telnyx settings. Check your connection and try again.");
    }
  };
  const doReauth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth?.currentUser?.email) return;
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
      const result = await reauthenticateWithCredential(auth.currentUser, credential);
      const token = await result.user.getIdToken(true);
      setReauthToken(token);
      setReauth(false);
      setPassword("");
      if (pendingTab === "Telnyx") {
        setTab("Telnyx");
        const r = await fetch("/api/telnyx/config", { headers: { "x-reauth-token": token } });
        if (r.ok) {
          const d = await r.json();
          if (d.configured)
            setSip((x) => ({
              ...x,
              voiceAppId: d.voiceAppId || "",
              outboundNumber: d.outboundNumber || "",
            }));
        }
      }
      setPendingTab("");
      setNotice("Identity confirmed.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not reauthenticate");
    }
  };
  const saveProfile = async () => {
    const r = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone }),
    });
    if (r.ok) window.location.reload();
    else setNotice("Profile could not be updated.");
  };
  const resetPassword = async () => {
    if (!auth?.currentUser?.email) return;
    await sendPasswordResetEmail(auth, auth.currentUser.email);
    setNotice("Password reset email sent.");
  };
  const tabs =
    user.role === "owner"
      ? [
          { label: "Team", icon: Users },
          { label: "Company", icon: ShieldCheck },
          { label: "Telnyx", icon: Phone },
          { label: "Profile", icon: UserRound },
        ]
      : [{ label: "Profile", icon: UserRound }];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your account and workspace preferences.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <nav className="h-fit rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
          {tabs.map((t) => (
            <button
              key={t.label}
              onClick={() => {
                if (t.label === "Telnyx" && !reauthToken) {
                  setPendingTab("Telnyx");
                  setReauth(true);
                } else setTab(t.label);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${tab === t.label ? "bg-indigo-50 font-semibold text-brand dark:bg-indigo-950" : "text-slate-600 dark:text-slate-300"}`}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </nav>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
          {notice && (
            <div className="mb-5 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-800">{notice}</div>
          )}
          {tab === "Team" && user.role === "owner" && (
            <>
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Team members</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Create and manage employee accounts.
                  </p>
                </div>
                <button
                  onClick={() => setShowEmployeeForm(true)}
                  className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
                >
                  <MailPlus size={15} /> Create employee
                </button>
              </div>
              {createdCredentials && (
                <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                  <div className="font-semibold">Employee account created</div>
                  <div className="mt-1 text-sm">{createdCredentials.email}</div>
                  <label className="mt-3 block text-xs font-semibold">
                    Initial password
                    <div className="mt-1 flex gap-2">
                      <input
                        readOnly
                        value={createdCredentials.password}
                        className="h-10 min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(createdCredentials.password)}
                        className="flex items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white"
                      >
                        <Copy size={15} /> Copy
                      </button>
                    </div>
                  </label>
                  <button
                    type="button"
                    onClick={() => setCreatedCredentials(null)}
                    className="mt-3 text-xs font-semibold text-emerald-800 underline"
                  >
                    Hide password
                  </button>
                </div>
              )}
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {team.data?.map((person: any) => (
                  <div key={person.uid} className="flex items-center gap-3 py-4">
                    <div className="grid h-9 w-9 place-items-center rounded-full bg-violet-50 text-sm font-semibold text-brand">
                      {person.name?.[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{person.name}</div>
                      <div className="text-xs text-slate-400">{person.email}</div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs capitalize text-slate-500">
                      {person.role}
                    </span>
                    {person.role === "employee" && (
                      <>
                        <button
                          title="Send password reset"
                          onClick={async () => {
                            if (!auth) {
                              setNotice("Firebase Auth is not configured.");
                              return;
                            }
                            try {
                              await sendPasswordResetEmail(auth, person.email);
                              setNotice("Firebase password reset email sent.");
                            } catch (err) {
                              setNotice(
                                err instanceof Error
                                  ? err.message
                                  : "Could not send password reset email.",
                              );
                            }
                          }}
                          className="text-slate-400 hover:text-brand"
                        >
                          <KeyRound size={16} />
                        </button>
                        <button
                          title={person.disabled ? "Enable employee" : "Disable employee"}
                          onClick={async () => {
                            const r = await fetch(`/api/users/${person.uid}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ disabled: !person.disabled }),
                            });
                            if (r.ok) team.refetch();
                            setNotice(
                              r.ok
                                ? `Employee ${person.disabled ? "enabled" : "disabled"}.`
                                : "Could not update employee.",
                            );
                          }}
                          className="text-slate-400 hover:text-amber-600"
                        >
                          <Power size={16} />
                        </button>
                        <button
                          title="Remove employee"
                          onClick={async () => {
                            if (!confirm(`Remove ${person.name} from this organization?`)) return;
                            const r = await fetch(`/api/users/${person.uid}`, { method: "DELETE" });
                            if (r.ok) team.refetch();
                            setNotice(r.ok ? "Employee removed." : "Could not remove employee.");
                          }}
                          className="text-slate-400 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === "Company" && user.role === "owner" && (
            <>
              <h2 className="font-semibold">Company information</h2>
              <p className="mt-1 text-sm text-slate-500">Details for your organization.</p>
              <label className="mt-6 block max-w-lg text-sm font-medium">
                Company name
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                />
              </label>
              <button
                onClick={async () => {
                  const r = await fetch("/api/organizations/me", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: company }),
                  });
                  setNotice(r.ok ? "Company details saved." : "Could not save company details.");
                }}
                className="mt-4 flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
              >
                <Save size={15} /> Save changes
              </button>
            </>
          )}
          {tab === "Telnyx" && user.role === "owner" && (
            <>
              <div className="mb-5 flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-50 text-brand">
                  <Phone size={18} />
                </div>
                <div>
                  <h2 className="font-semibold">Telnyx connection</h2>
              <p className="mt-1 text-sm text-slate-500">
                    API credentials are encrypted at rest. Set the three values used by your Telnyx Voice API application.
                  </p>
                </div>
              </div>
              <form onSubmit={saveConfig} className="grid max-w-2xl gap-4 sm:grid-cols-2">
                {(
                  [
                    ["apiKey", "Telnyx API key", "password"],
                    ["voiceAppId", "Voice API Application ID", "text"],
                    ["outboundNumber", "Caller ID number", "tel"],
                  ] as const
                ).map(([key, label, type]) => (
                  <label key={key} className="text-sm font-medium">
                    {label}
                    <input
                      required={key !== "apiKey"}
                      value={sip[key]}
                      type={type}
                      placeholder={key === "apiKey" ? "Paste secret key; leave blank to keep saved key" : undefined}
                      onChange={(e) => setSip({ ...sip, [key]: e.target.value })}
                      className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-transparent px-3 font-normal dark:border-slate-700"
                    />
                  </label>
                ))}
                <p className="text-xs leading-5 text-slate-500 sm:col-span-2">
                  Use a Telnyx API v2 secret key from Account Settings → API Keys. If you lost the full key, create a new one; the portal only shows the secret when it is created. Do not paste an API v1 token or key label.
                </p>
                <p className="text-xs leading-5 text-slate-500 sm:col-span-2">
                  Set the Voice API Application webhook URL to your Render URL ending in
                  <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">/api/telnyx/webhook</code>
                  using webhook API v2. Also set the matching TELNYX_PUBLIC_KEY environment variable on the server; it is required to verify Telnyx callbacks. Each employee must save their mobile or desk phone in Profile before calling.
                  For local testing, set <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">NEXT_PUBLIC_APP_URL</code> to a public HTTPS tunnel; Telnyx cannot send callbacks to localhost.
                </p>
                <div className="sm:col-span-2">
                  <button className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
                    <Save size={15} /> Save Telnyx settings
                  </button>
                </div>
              </form>
            </>
          )}
          {tab === "Profile" && (
            <>
              <h2 className="font-semibold">Your profile</h2>
              <p className="mt-1 text-sm text-slate-500">
                Update your personal details and login password.
              </p>
              <label className="mt-6 block max-w-lg text-sm font-medium">
                Full name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                />
              </label>
              <label className="mt-4 block max-w-lg text-sm font-medium">
                Phone number for calls
                <input
                  value={phone}
                  type="tel"
                  placeholder="+1 555 123 4567"
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-transparent px-3 dark:border-slate-700"
                />
                <span className="mt-1 block text-xs font-normal text-slate-400">Telnyx calls this number first, then connects your contact.</span>
              </label>
              <div className="mt-2 max-w-lg text-xs text-slate-400">{user.email}</div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => void saveProfile()}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
                >
                  Save profile
                </button>
                <button
                  onClick={() => void resetPassword()}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-slate-700"
                >
                  Change password
                </button>
              </div>
            </>
          )}
        </section>
      </div>
      {showEmployeeForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <form
            onSubmit={createEmployee}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
          >
            <h2 className="text-lg font-semibold">Create employee account</h2>
            <p className="mt-1 text-sm text-slate-500">
              You create the Firebase login. Share the initial password with the employee securely.
            </p>
            <label className="mt-5 block text-sm">
              Name
              <input
                required
                value={employeeForm.name}
                onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })}
                className="mt-1.5 h-10 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="mt-4 block text-sm">
              Work email
              <input
                required
                type="email"
                value={employeeForm.email}
                onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })}
                className="mt-1.5 h-10 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="mt-4 block text-sm">
              Initial password
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={employeeForm.password}
                onChange={(e) => setEmployeeForm({ ...employeeForm, password: e.target.value })}
                className="mt-1.5 h-10 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-950"
              />
              <span className="mt-1 block text-xs font-normal text-slate-400">
                At least 8 characters. Employees can change it using Forgot password.
              </span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowEmployeeForm(false)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
                Create account
              </button>
            </div>
          </form>
        </div>
      )}
      {reauth && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <form
            onSubmit={doReauth}
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
          >
            <h2 className="font-semibold">Confirm it’s you</h2>
            <p className="mt-1 text-sm text-slate-500">
              Enter your password to update Telnyx credentials.
            </p>
            <input
              autoFocus
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-4 h-11 w-full rounded-lg border px-3 dark:border-slate-700 dark:bg-slate-950"
              placeholder="Password"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReauth(false)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
                Continue
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
