"use client";

import { useState } from "react";
import { Activity, BarChart3, BriefcaseBusiness, ChevronDown, CircleHelp, ContactRound, LogOut, Menu, Moon, Phone, PhoneCall, Plus, Settings, ShieldCheck, Sun, X } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { Dashboard } from "@/components/workspace/dashboard";
import { Contacts } from "@/components/workspace/contacts";
import { CallLogs } from "@/components/workspace/call-logs";
import { Dialer } from "@/components/workspace/dialer";
import { SettingsView } from "@/components/workspace/settings";

type View = "Dashboard" | "Contacts" | "Call logs" | "Dialer" | "Settings";
const nav = [
  { title: "WORKSPACE", items: [{ label: "Dashboard", icon: BarChart3 }, { label: "Contacts", icon: ContactRound }, { label: "Call logs", icon: Activity }] },
  { title: "TOOLS", items: [{ label: "Dialer", icon: Phone }] },
  { title: "MANAGE", items: [{ label: "Settings", icon: Settings }] },
];

export function Workspace({ user }: { user: SessionUser }) {
  const [view, setView] = useState<View>("Dashboard"); const [open, setOpen] = useState(false); const [dark, setDark] = useState(false);
  const logout = async () => { await fetch("/api/auth/session", { method: "DELETE" }); location.href = "/login"; };
  const component = view === "Contacts" ? <Contacts user={user} /> : view === "Call logs" ? <CallLogs /> : view === "Dialer" ? null : view === "Settings" ? <SettingsView user={user} /> : <Dashboard user={user} onNavigate={setView} />;
  return <div className={dark ? "dark" : ""}>
    <div className="min-h-screen bg-[#f7f8fc] text-ink dark:bg-[#111827] dark:text-slate-100">
      {open && <button aria-label="Close menu" onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-950 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-[76px] items-center gap-3 border-b border-slate-100 px-6 dark:border-slate-800"><div className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white"><PhoneCall size={18} /></div><div><div className="font-semibold tracking-tight">Ancentrix<span className="text-brand"> Dial</span></div><div className="text-[11px] text-slate-400">TEAM WORKSPACE</div></div><button onClick={() => setOpen(false)} className="ml-auto lg:hidden"><X size={18}/></button></div>
        <div className="mx-4 mt-5 flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800"><div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-brand"><BriefcaseBusiness size={17}/></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{user.name.split(" ")[0]}&apos;s workspace</div><div className="text-xs text-slate-400">{user.role === "owner" ? "Owner account" : "Team member"}</div></div><ChevronDown size={15} className="text-slate-400"/></div>
        <nav className="mt-7 flex-1 space-y-7 px-4">{nav.map(group => <div key={group.title}><div className="mb-2 px-3 text-[10px] font-semibold tracking-[.13em] text-slate-400">{group.title}</div><div className="space-y-1">{group.items.map(item => <button key={item.label} onClick={() => { setView(item.label as View); setOpen(false); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${view === item.label ? "bg-indigo-50 font-semibold text-brand dark:bg-indigo-950/60" : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"}`}><item.icon size={17}/>{item.label}{item.label === "Dialer" && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500"/>}</button>)}</div></div>)}</nav>
        <div className="m-4 rounded-xl bg-[#f6f5ff] p-4 dark:bg-slate-900"><div className="mb-2 grid h-8 w-8 place-items-center rounded-lg bg-white text-brand shadow-sm dark:bg-slate-800"><ShieldCheck size={16}/></div><div className="text-sm font-semibold">Human first, always.</div><div className="mt-1 text-xs leading-5 text-slate-500">Stay connected with your customers, one conversation at a time.</div><button onClick={() => setView("Dialer")} className="mt-3 text-xs font-semibold text-brand">Open dialer <span>→</span></button></div>
        <div className="border-t border-slate-100 p-4 dark:border-slate-800"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-sm font-bold text-white">{user.name.slice(0,1).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{user.name}</div><div className="truncate text-xs text-slate-400">{user.email}</div></div><button onClick={logout} title="Sign out" className="text-slate-400 hover:text-slate-700"><LogOut size={16}/></button></div></div>
      </aside>
      <div className="lg:pl-[252px]"><header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-slate-200 bg-white/90 px-5 backdrop-blur sm:px-8 dark:border-slate-800 dark:bg-slate-950/90"><div className="flex items-center gap-3"><button className="lg:hidden" onClick={() => setOpen(true)}><Menu size={21}/></button><div><div className="text-sm text-slate-400">Workspace <span className="px-1">/</span> <span className="text-slate-700 dark:text-slate-200">{view}</span></div><div className="hidden text-[11px] text-slate-400 sm:block">A clear view of your customer conversations</div></div></div><div className="flex items-center gap-2"><button onClick={() => setView("Dialer")} className="hidden items-center gap-2 rounded-lg bg-brand px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark sm:flex"><Plus size={16}/> New call</button><button title="Toggle theme" onClick={() => setDark(!dark)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">{dark ? <Sun size={17}/> : <Moon size={17}/>}</button><button title="Help" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-50"><CircleHelp size={18}/></button></div></header><main className="mx-auto max-w-[1440px] p-5 sm:p-8"><Dialer visible={view === "Dialer"} user={user}/>{component}</main></div>
    </div></div>;
}
