"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Delete, PhoneForwarded } from "lucide-react";
import type { SessionUser } from "@/lib/auth";

type ActiveCall = {
  id: string;
  status: string;
  number?: string | null;
  contactName?: string | null;
  connectedAt: number | null;
  customerDialedAt: number | null;
  customerAnsweredAt?: number | null;
  customerDialStatus?: string | null;
  customerDialError?: string | null;
  customerDialHttpStatus?: number | null;
  customerDialTarget?: string | null;
  customerDialAttemptedAt?: number | null;
  customerDialCallerId?: string | null;
  agentDialStatus?: string | null;
  agentAnsweredAt?: number | null;
  agentCallControlId?: string | null;
  customerCallControlId?: string | null;
  bridgeMode?: string | null;
  hangupError?: string | null;
  lastWebhookLeg?: string | null;
  lastWebhookCallControlId?: string | null;
  lastWebhookFrom?: string | null;
  lastWebhookTo?: string | null;
  lastTelnyxEventAt?: number | null;
  webhookError?: string | null;
  webhookErrorEventType?: string | null;
  webhookErrorLeg?: string | null;
  callSessionId?: string | null;
  agentCallSessionId?: string | null;
  customerCallSessionId?: string | null;
  agentBridgedAt?: number | null;
  customerBridgedAt?: number | null;
  lastTelnyxEvent?: string | null;
  sipHangupCause?: string | null;
  hangupCause?: string | null;
  endedAt: boolean;
  endedByLeg?: string | null;
  errorMessage?: string | null;
  duration: number;
};
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
            setStatus(next.status === "connected" || next.status === "ended" ? "Call ended" : next.status === "missed" ? (next.endedByLeg === "agent" ? "Your phone was not answered" : "The contact did not answer") : next.status === "rejected" ? "Call ended" : next.customerDialError || next.errorMessage || "Call failed");
          } else {
            setCall(next);
            setStatus(
              next.hangupError
                ? `Hangup error: ${next.hangupError}`
                : next.status === "ending"
                  ? "Telnyx is ending both phone legs…"
                  : next.customerDialError
                    ? `Customer call failed: ${next.customerDialError}`
                    : next.connectedAt
                  ? "Telnyx confirms both legs bridged — verify audio on the two phones"
                  : next.customerDialStatus === "initiating"
                    ? "Your phone answered — starting the customer call…"
                    : next.customerDialStatus === "ringing"
                      ? "Your phone answered — customer phone is ringing…"
                      : next.customerDialStatus === "answered"
                        ? "Customer answered — waiting for Telnyx to bridge both legs…"
                        : next.customerDialStatus === "failed"
                          ? `Customer call failed: ${next.customerDialError || next.errorMessage || "Telnyx rejected the second call."}`
                          : next.agentAnsweredAt
                            ? "Your phone answered — waiting for the customer-call request…"
                            : "Calling your profile phone… answer it to call the customer.",
            );
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
      setCall({ id: data.id, status: data.status, connectedAt: null, customerDialedAt: null, customerAnsweredAt: null, endedAt: false, duration: 0 });
      setStatus("Calling your phone… answer it and Telnyx will call the contact.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Call could not be started."); }
    finally { setBusy(false); }
  };

  const hangup = async () => {
    const active = callRef.current;
    if (!active) return;
    setStatus("Ending both call legs…");
    try {
      const response = await fetch(`/api/telnyx/calls/${active.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(result.error || "Telnyx did not confirm that both phones disconnected. Retry End call.");
        return;
      }
      setCall(null);
      setStatus("Call ended on both phones");
    } catch {
      setStatus("Could not reach the server to end the call. Check your connection and retry.");
    }
  };
  const format = (value: number) => `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;

  return <div className={`${visible ? "" : "hidden "}mx-auto max-w-[1060px] space-y-6`}>
    <div><h1 className="text-2xl font-semibold">Dialer</h1><p className="mt-1 text-sm text-slate-500">Start a call here. Telnyx rings your saved phone first, then calls and connects the selected contact.</p></div>
    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-brand"><PhoneForwarded size={18}/></div><div><div className="text-sm font-semibold">Phone bridge</div><div className="text-xs text-slate-500">Your phone: {user.phone || "Add a phone number in Settings → Profile"}</div></div></div>
        <div className="mx-auto mt-8 max-w-sm text-center"><div className="mb-3 min-h-5 text-xs font-medium text-slate-500">{status}</div>{call?.connectedAt && <div className="mb-3 font-mono text-xl tabular-nums">{format(seconds)}</div>}
          <div className="flex items-center rounded-xl border border-slate-200 px-4 dark:border-slate-700"><input value={number} disabled={!!call} onChange={(event) => { setNumber(event.target.value); setContactName(""); }} onKeyDown={(event) => event.key === "Enter" && void place()} placeholder="Enter a number with country code, e.g. +919876543210" type="tel" className="h-14 w-full bg-transparent text-center text-xl outline-none placeholder:text-slate-300 disabled:opacity-60"/><button disabled={!!call} onClick={() => { setNumber(number.slice(0, -1)); setContactName(""); }} title="Delete digit" className="text-slate-400 disabled:opacity-40"><Delete size={18}/></button></div>
          <div className="mx-auto mt-4 grid max-w-[300px] grid-cols-3 gap-3">{["1","2","3","4","5","6","7","8","9","*","0","#"].map((digit) => <button key={digit} disabled={!!call} onClick={() => { setNumber((value) => value + digit); setContactName(""); }} className="h-14 rounded-xl bg-slate-50 text-xl font-medium hover:bg-indigo-50 hover:text-brand disabled:opacity-40 dark:bg-slate-800 dark:hover:bg-slate-700">{digit}</button>)}</div>
          <div className="mt-5 flex justify-center">{call ? <button onClick={() => void hangup()} className="flex h-12 items-center gap-2 rounded-xl bg-red-500 px-6 font-semibold text-white"><PhoneOff size={18}/> End call</button> : <button disabled={busy || !user.phone} onClick={() => void place()} className="flex h-12 items-center gap-2 rounded-xl bg-emerald-500 px-8 font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"><Phone size={18}/> {busy ? "Starting…" : "Call"}</button>}</div>
        </div>
      </section>
      <section className="rounded-2xl bg-[#f1f0ff] p-5 dark:bg-indigo-950/50"><div className="font-semibold">How calls work</div><ol className="mt-2 list-inside list-decimal space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300"><li>Enter the customer’s phone number.</li><li>Telnyx first calls your saved profile phone number.</li><li>After you answer, Telnyx calls the customer.</li><li>When the customer answers, Telnyx automatically bridges both call legs. The timer starts after Telnyx confirms the bridge.</li></ol><p className="mt-4 text-xs text-slate-500">Inbound calls to your Telnyx number ring the workspace owner’s phone.</p>{call && <div className="mt-4 rounded-xl border border-indigo-200 bg-white/70 p-3 text-xs dark:border-indigo-900 dark:bg-slate-900/60">
        <div className="font-semibold">Call diagnostics</div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600 dark:text-slate-300">
          <span>Customer destination</span><span className="break-all text-right font-mono">{call.customerDialTarget || call.number || number || "—"}</span>
          <span>Profile phone state</span><span className="text-right font-semibold">{call.agentDialStatus || "initiating"}</span>
          <span>Customer dial state</span><span className="text-right font-semibold">{call.customerDialStatus || "Waiting for profile phone"}{call.customerDialHttpStatus ? ` (HTTP ${call.customerDialHttpStatus})` : ""}</span>
          <span>Customer dial requested</span><span className="text-right">{call.customerDialAttemptedAt ? new Date(call.customerDialAttemptedAt).toLocaleTimeString() : "Not yet"}</span>
          <span>Agent webhook</span><span className="text-right">{call.lastTelnyxEvent || "Not received"}{call.lastWebhookLeg ? ` (${call.lastWebhookLeg})` : ""}</span>
          <span>Webhook destination</span><span className="break-all text-right font-mono">{call.lastWebhookTo || "—"}</span>
          <span>Agent bridged</span><span className="text-right">{call.agentBridgedAt ? "Yes" : "Not confirmed"}</span>
          <span>Customer bridged</span><span className="text-right">{call.customerBridgedAt ? "Yes" : "Not confirmed"}</span>
          <span>Agent call-control ID</span><span className="break-all text-right font-mono">{call.agentCallControlId || "Waiting"}</span>
          <span>Customer call-control ID</span><span className="break-all text-right font-mono">{call.customerCallControlId || "Not created"}</span>
          <span>Session ID</span><span className="break-all text-right font-mono">{call.callSessionId || "Waiting"}</span>
        </div>
        {call.customerDialError && <p className="mt-2 break-words text-red-600">Customer dial error: {call.customerDialError}</p>}
        {call.webhookError && <p className="mt-2 break-words text-red-600">Webhook error ({call.webhookErrorEventType || "event"}/{call.webhookErrorLeg || "unknown leg"}): {call.webhookError}</p>}
        {call.hangupError && <p className="mt-2 break-words text-red-600">Hangup error: {call.hangupError}</p>}
        {call.callSessionId && <button type="button" onClick={() => void navigator.clipboard?.writeText(call.callSessionId || "")} className="mt-2 font-semibold text-brand hover:underline">Copy session ID</button>}
      </div>}</section>
    </div>
  </div>;
}
