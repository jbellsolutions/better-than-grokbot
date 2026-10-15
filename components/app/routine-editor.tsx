"use client";
import { useState } from "react";
import type { Bot, Schedule } from "@/lib/types";
import { post } from "./ui";

export function RoutineEditor({ bot, timezone }: { bot: Bot; timezone?: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [kind, setKind] = useState<Schedule["kind"]>("weekdays");
  const [time, setTime] = useState("09:00");
  const [day, setDay] = useState(1);
  const [once, setOnce] = useState("");
  const [reminder, setReminder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = "rounded-lg bg-white px-3 py-2 text-[13px] text-ink shadow-[0_0_0_1px_#00000015]";
  const save = async () => {
    setBusy(true); setError("");
    try {
      const schedule: Schedule = kind === "once" ? { kind, at: new Date(once).getTime() } : kind === "weekly" ? { kind, time, day } : { kind, time };
      const res = await post("/api/routines", { botId: bot.id, title, goal, schedule, ...(reminder ? { reminder: goal } : {}) });
      if (!res.ok) throw Error((await res.json()).error || "Could not save the routine.");
      setOpen(false); setTitle(""); setGoal("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="px-4 py-2 text-[12px]">
    <button onClick={() => setOpen(!open)} className="font-medium underline">{open ? "Cancel new routine" : "+ Add routine"}</button>
    {open && <form className="mt-2 flex flex-col gap-2" onSubmit={e => { e.preventDefault(); void save(); }}>
      <input required aria-label="Routine title" placeholder="Routine title" value={title} onChange={e => setTitle(e.target.value)} className={input} />
      <textarea required aria-label="Routine goal" placeholder={`What should ${bot.name} do?`} value={goal} onChange={e => setGoal(e.target.value)} className={input} />
      <select aria-label="Routine frequency" value={kind} onChange={e => setKind(e.target.value as typeof kind)} className={input}>
        <option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="once">Once</option>
      </select>
      {kind === "weekly" && <select aria-label="Routine day" value={day} onChange={e => setDay(Number(e.target.value))} className={input}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, i) => <option key={i} value={i}>{label}</option>)}</select>}
      {kind === "once" ? <input required aria-label="Run at" type="datetime-local" value={once} onChange={e => setOnce(e.target.value)} className={input} /> : <input required aria-label="Routine time" type="time" value={time} onChange={e => setTime(e.target.value)} className={input} />}
      <span className="text-[#6B6B6B]">Daily and weekly times use the coordinator’s timezone: {timezone ?? "checking…"}. One-off times use your local time. Keep the coordinator running.</span>
      <label className="flex items-center gap-2"><input type="checkbox" checked={reminder} onChange={e => setReminder(e.target.checked)} />Send a reminder instead of running a task</label>
      <button disabled={busy} className="self-start rounded-full bg-ink px-3 py-1.5 font-medium text-white">{busy ? "Saving…" : "Save routine"}</button>
    </form>}
    {error && <span role="alert" className="mt-1 block text-[#B42318]">{error}</span>}
  </div>;
}
