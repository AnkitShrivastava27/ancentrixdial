"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Delete, PhoneForwarded } from "lucide-react";
import type { SessionUser } from "@/lib/auth";

type ActiveCall = { id: string; status: string; connectedAt: number | null; customerDialedAt: number | null; endedAt: boolean; endedByLeg?: string | null; errorMessage?: string | null; duration: number };
type DialTarget = { number: string; contactName: string };

export function Dialer({ visible = true, user, initialTarget }: { visible?: boolean; user: SessionUser; initialTarget?: DialTarget | null }) {
  const [number, setNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [status, setStatus] = useState("Ready to call");
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const callRef = useRef<ActiveCall | null>(null);
  callRef.current = call;

  useEffect(() => {
    if (!initialTarget?.number) return;
    setNumber(initialTarget.number);
    setContactName(initialTarget.contactName || "");
    setStatus(`Ready to call ${initialTarget.contactName || initialTarget.number}`);
  }, [initialTarget]);

  useEffect(() => {
    const callId = call?.id;
    if (!callId) return;
    let stopped = false;
    let timeout: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/telnyx/calls/${callId}`, { cache: "no-store" });
        if (response.ok) {
          const next = await response.json() as ActiveCall;
          if (next.endedAt || ["missed", "failed", "rejected"].includes(next.status)) {
            setCall(null);
            setSeconds(next.duration || 0);
            setStatus(next.status === "connected" ? "Call ended" : next.status === "missed" ? (next.endedByLeg === "agent" ? "Your phone was not answered" : "The contact did not answer") : next.status === "rejected" ? "Call ended" : next.errorMessage || "Call failed");
          } else {
            setCall(next);
            setStatus(next.connectedAt ? "Connected — speak on your phone" : next.customerDialedAt ? "Your phone answered — calling the contact…" : "Calling your phone… answer it to call the contact.");
            if (next.connectedAt) setSeconds(Math.max(0, Math.floor((Date.now() - next.connectedAt) / 1000)));
          }
        }
      } catch {
        // Retry on the next poll; the call itself is controlled by Telnyx.
      } finally {
        if (!stopped) timeout = window.setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => { stopped = true; if (timeout !== undefined) window.clearTimeout(timeout); };
  }, [call?.id]);

  const place = async () => {
    if (!number.trim() || busy || call) return;
    setBusy(true); setStatus("Starting call…"); setSeconds(0);
    try {
      const response = await fetch("/api/telnyx/calls", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: number.trim(), contactName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Call could not be started.");
      setCall({ id: data.id, status: data.status, connectedAt: null, customerDialedAt: null, endedAt: false, duration: 0 });
      setStatus("Calling your phone… answer it and Telnyx will call the contact.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Call could not be started."); }
    finally { setBusy(false); }
  };

  const hangup = async () => {
    const active = callRef.current;
    if (!active) return;
    setStatus("Ending call…");
    await fetch(`/api/telnyx/calls/${active.id}`, { method: "DELETE" }).catch(() => {});
    setCall(null); setStatus("Call ended");
  };
  const format = (value: number) => `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;

  return <div className={`${visible ? "" : "hidden "}mx-auto max-w-[1060px] space-y-6`}>
    <div><h1 className="text-2xl font-semibold">Dialer</h1><p className="mt-1 text-sm text-slate-500">Start a call here. Telnyx rings your saved phone first, then calls and connects the selected contact.</p></div>
    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-brand"><PhoneForwarded size={18}/></div><div><div className="text-sm font-semibold">Phone bridge</div><div className="text-xs text-slate-500">Your phone: {user.phone || "Add a phone number in Settings → Profile"}</div></div></div>
        <div className="mx-auto mt-8 max-w-sm text-center"><div className="mb-3 min-h-5 text-xs font-medium text-slate-500">{status}</div>{call?.connectedAt && <div className="mb-3 font-mono text-xl tabular-nums">{format(seconds)}</div>}
          <div className="flex items-center rounded-xl border border-slate-200 px-4 dark:border-slate-700"><input value={number} onChange={(event) => { setNumber(event.target.value); setContactName(""); }} onKeyDown={(event) => event.key === "Enter" && void place()} placeholder="Enter a phone number" type="tel" className="h-14 w-full bg-transparent text-center text-xl outline-none placeholder:text-slate-300"/><button onClick={() => { setNumber(number.slice(0, -1)); setContactName(""); }} title="Delete digit" className="text-slate-400"><Delete size={18}/></button></div>
          <div className="mx-auto mt-4 grid max-w-[300px] grid-cols-3 gap-3">{["1","2","3","4","5","6","7","8","9","*","0","#"].map((digit) => <button key={digit} onClick={() => { setNumber((value) => value + digit); setContactName(""); }} className="h-14 rounded-xl bg-slate-50 text-xl font-medium hover:bg-indigo-50 hover:text-brand dark:bg-slate-800 dark:hover:bg-slate-700">{digit}</button>)}</div>
          <div className="mt-5 flex justify-center">{call ? <button onClick={() => void hangup()} className="flex h-12 items-center gap-2 rounded-xl bg-red-500 px-6 font-semibold text-white"><PhoneOff size={18}/> End call</button> : <button disabled={busy || !user.phone} onClick={() => void place()} className="flex h-12 items-center gap-2 rounded-xl bg-emerald-500 px-8 font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"><Phone size={18}/> {busy ? "Starting…" : "Call"}</button>}</div>
        </div>
      </section>
      <section className="rounded-2xl bg-[#f1f0ff] p-5 dark:bg-indigo-950/50"><div className="font-semibold">How calls work</div><ol className="mt-2 list-inside list-decimal space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300"><li>Enter the customer’s phone number.</li><li>Telnyx first calls your saved profile phone number.</li><li>After you answer, Telnyx places a second call to the customer and bridges both calls when they answer.</li></ol><p className="mt-4 text-xs text-slate-500">Inbound calls to your Telnyx number ring the workspace owner’s phone.</p></section>
    </div>
  </div>;
}
