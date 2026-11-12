"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, ArrowUpRight as ArrowIcon, Phone, PhoneMissed, Users } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar } from "recharts";
import { useQuery } from "@tanstack/react-query";
import type { SessionUser } from "@/lib/auth";

type CallLog = {
  id: string;
  contactName?: string;
  number?: string;
  direction?: string;
  status?: string;
  duration?: number;
  connectedAt?: Date | string | number | { seconds?: number; _seconds?: number; toDate?: () => Date } | null;
  userName?: string;
  createdAt?: Date | string | number | { seconds?: number; _seconds?: number; toDate?: () => Date } | null;
};

type ActivityRange = "week" | "month";
type ActivityPoint = { key: string; day: string; calls: number; connected: number };

async function fetchData<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${path} (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function getCallDate(value: CallLog["createdAt"]): Date | null {
  if (value == null) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value.toDate === "function") {
    const parsed = value.toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }

  const seconds = value.seconds ?? value._seconds;
  if (typeof seconds === "number") {
    const parsed = new Date(seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildCallActivity(calls: CallLog[], range: ActivityRange): ActivityPoint[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firstDay = new Date(today);
  if (range === "week") {
    firstDay.setDate(today.getDate() - 6);
  } else {
    firstDay.setDate(1);
  }

  const points: ActivityPoint[] = [];
  const pointByDate = new Map<string, ActivityPoint>();

  for (const cursor = new Date(firstDay); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
    const date = new Date(cursor);
    const key = dateKey(date);
    const point: ActivityPoint = {
      key,
      day: range === "week"
        ? new Intl.DateTimeFormat("en", { weekday: "short" }).format(date)
        : String(date.getDate()),
      calls: 0,
      connected: 0,
    };
    points.push(point);
    pointByDate.set(key, point);
  }

  for (const call of calls) {
    const createdAt = getCallDate(call.createdAt);
    if (!createdAt) continue;

    const point = pointByDate.get(dateKey(createdAt));
    if (!point) continue;

    point.calls += 1;
    if (call.connectedAt || call.status === "connected") point.connected += 1;
  }

  return points;
}

export function Dashboard({ user, onNavigate }: { user: SessionUser; onNavigate: (view: "Contacts" | "Call logs" | "Dialer") => void }) {
  const [activityRange, setActivityRange] = useState<ActivityRange>("week");
  const calls = useQuery({ queryKey: ["calls"], queryFn: () => fetchData<CallLog[]>("/api/call-logs"), refetchInterval: 30_000 });
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => fetchData<any[]>("/api/contacts") });
  const team = useQuery({ queryKey: ["team"], queryFn: () => fetchData<any[]>("/api/users"), enabled: user.role === "owner" });

  const allCalls = calls.data ?? [];
  const today = new Date();
  const todayCalls = allCalls.filter((call) => {
    const createdAt = getCallDate(call.createdAt);
    return createdAt?.toDateString() === today.toDateString();
  });
  const connected = allCalls.filter((call) => Boolean(call.connectedAt) || call.status === "connected").length;
  const missed = allCalls.filter((call) => call.status === "missed").length;
  const activity = useMemo(() => buildCallActivity(allCalls, activityRange), [allCalls, activityRange]);
  const hasActivity = activity.some((point) => point.calls > 0);

  const cards = [
    { label: "Total calls", value: allCalls.length, icon: Phone, change: "Recorded calls", tone: "text-brand bg-indigo-50" },
    { label: "Today's calls", value: todayCalls.length, icon: ArrowUpRight, change: "Since midnight", tone: "text-sky-600 bg-sky-50" },
    { label: "Connected calls", value: connected, icon: Phone, change: `${allCalls.length ? Math.round((connected / allCalls.length) * 100) : 0}% connection rate`, tone: "text-emerald-600 bg-emerald-50" },
    { label: "Missed calls", value: missed, icon: PhoneMissed, change: "Calls needing follow-up", tone: "text-amber-600 bg-amber-50" },
    { label: "Total contacts", value: contacts.data?.length || 0, icon: Users, change: "In your address book", tone: "text-violet-600 bg-violet-50" },
    ...(user.role === "owner" ? [{ label: "Employees", value: team.data?.filter((member: any) => member.role === "employee").length || 0, icon: Users, change: "Active team members", tone: "text-blue-600 bg-blue-50" }] : []),
  ];

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">{new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Good morning, {user.name.split(" ")[0]} <span>👋</span></h1>
          <p className="mt-1 text-sm text-slate-500">Here’s what’s happening with your conversations today.</p>
        </div>
        <button onClick={() => onNavigate("Dialer")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
          <Phone size={16} /> Start a call
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between">
              <div className="text-sm text-slate-500">{card.label}</div>
              <div className={`grid h-9 w-9 place-items-center rounded-lg ${card.tone}`}><card.icon size={17} /></div>
            </div>
            <div className="mt-4 text-3xl font-semibold">{card.value}</div>
            <div className="mt-2 text-xs text-slate-400">{card.change}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Call activity</h2>
              <p className="mt-1 text-sm text-slate-500">Recorded calls in your workspace</p>
            </div>
            <select
              aria-label="Call activity date range"
              value={activityRange}
              onChange={(event) => setActivityRange(event.target.value as ActivityRange)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <option value="week">Last 7 days</option>
              <option value="month">This month</option>
            </select>
          </div>

          <div className="mt-5 h-[250px]">
            {calls.isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading call activity…</div>
            ) : calls.isError ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-rose-500">
                <span>Call activity could not be loaded.</span>
                <button onClick={() => calls.refetch()} className="font-semibold text-brand">Try again</button>
              </div>
            ) : !hasActivity ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-slate-50 text-slate-400 dark:bg-slate-800"><Phone size={19} /></div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No call records for this period</p>
                <p className="max-w-xs text-xs text-slate-400">Calls will appear here after they are recorded in your workspace.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activity}>
                  <defs>
                    <linearGradient id="fillCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#635bff" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#635bff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#eef0f5" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} interval="preserveStartEnd" tick={{ fontSize: 12, fill: "#98a2b3" }} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#98a2b3" }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="calls" name="All calls" stroke="#635bff" strokeWidth={2.5} fill="url(#fillCalls)" />
                  <Area type="monotone" dataKey="connected" name="Connected" stroke="#24b47e" strokeWidth={2} fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 flex justify-center gap-6 text-xs">
            <span className="flex items-center gap-2 text-slate-500"><i className="h-2 w-2 rounded-full bg-brand" />All calls</span>
            <span className="flex items-center gap-2 text-slate-500"><i className="h-2 w-2 rounded-full bg-emerald-500" />Connected</span>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-soft dark:border-slate-800 dark:bg-slate-900">
          <div>
            <h2 className="font-semibold">Call outcomes</h2>
            <p className="mt-1 text-sm text-slate-500">Connected and missed calls</p>
          </div>
          <div className="mt-2 h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ name: "Connected", value: connected }, { name: "Missed", value: missed }]}>
                <CartesianGrid vertical={false} stroke="#eef0f5" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#98a2b3" }} />
                <YAxis allowDecimals={false} hide />
                <Tooltip />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#635bff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
            <span className="text-slate-500">Total contacts</span><span className="font-semibold">{contacts.data?.length || 0}</span>
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <div><h2 className="font-semibold">Recent calls</h2><p className="mt-1 text-xs text-slate-500">Latest team activity</p></div>
            <button onClick={() => onNavigate("Call logs")} className="text-xs font-semibold text-brand">View all <ArrowIcon size={13} className="ml-1 inline" /></button>
          </div>
          {allCalls.length ? allCalls.slice(0, 5).map((call) => (
            <div key={call.id} className="flex items-center gap-3 border-b border-slate-50 px-5 py-3 last:border-0 dark:border-slate-800">
              <div className={`grid h-9 w-9 place-items-center rounded-full ${call.connectedAt || call.status === "connected" || (call.status === "ended" && (call.duration || 0) > 0) ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}><Phone size={15} /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{call.contactName || call.number || "Unknown caller"}</div>
                <div className="text-xs text-slate-400">{call.direction || "Call"} · {call.userName || "Team"}</div>
              </div>
              <span className="text-xs capitalize text-slate-500">{call.status || "unknown"}</span>
            </div>
          )) : (
            <div className="px-5 py-10 text-center text-sm text-slate-400">Your recorded calls will appear here.</div>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <div><h2 className="font-semibold">Recent contacts</h2><p className="mt-1 text-xs text-slate-500">People in your address book</p></div>
            <button onClick={() => onNavigate("Contacts")} className="text-xs font-semibold text-brand">View all <ArrowIcon size={13} className="ml-1 inline" /></button>
          </div>
          {contacts.data?.length ? contacts.data.slice(0, 5).map((contact: any) => (
            <div key={contact.id} className="flex items-center gap-3 border-b border-slate-50 px-5 py-3 last:border-0 dark:border-slate-800">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-violet-50 text-xs font-semibold text-violet-600">{(contact.name || "?").split(" ").map((word: string) => word[0]).slice(0, 2).join("")}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{contact.name || "Unnamed contact"}</div>
                <div className="text-xs text-slate-400">{contact.company || contact.phone}</div>
              </div>
              <button title="Call contact" onClick={() => onNavigate("Dialer")} className="text-slate-400 hover:text-brand"><Phone size={16} /></button>
            </div>
          )) : (
            <div className="px-5 py-10 text-center text-sm text-slate-400">Add a contact to get started.</div>
          )}
        </section>
      </div>
    </div>
  );
}
