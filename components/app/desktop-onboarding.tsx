"use client";
import { useCallback, useEffect, useState } from "react";
import { SignIn } from "./sign-in";
import { ModelSettings } from "./model-settings";
import { AccountComputers } from "./account-computers";
import type { AppState } from "@/lib/types";

type Status = { enabled: boolean; complete: boolean; provider?: boolean; model?: boolean; orgo?: boolean; computer?: boolean };
export function DesktopOnboarding({ state, children }: { state: AppState | null; children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/desktop-setup", { cache: "no-store" });
      if (!r.ok) throw Error("Could not read setup. Try again.");
      setStatus(await r.json()); setError(previous => previous === "Could not read setup. Try again." ? "" : previous);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { const first = setTimeout(() => void refresh(), 0); const t = setInterval(() => void refresh(), 3000); return () => { clearTimeout(first); clearInterval(t); }; }, [refresh]);
  if (status && (!status.enabled || status.complete)) return children;
  if (status?.provider && status.model && !status.orgo) return <SignIn allowApiKey onSignedIn={() => void refresh()} />;
  const main = state?.bots.find(b => b.isMain);
  return <div className="flex min-h-screen items-center justify-center bg-desk p-8 text-ink">
    <main className="flex w-full max-w-xl flex-col gap-4 rounded-3xl bg-white p-8 shadow-lg">
      <h1 className="text-2xl font-semibold">Better Than GrokBot</h1>
      {!status ? <p>Loading setup…</p> : !status.provider ? <>
        <h2 className="text-lg font-medium">1. Connect OpenRouter</h2>
        <p>Use your own key to chat and run agents with your choice of models. OpenRouter bills model usage to your account.</p>
        <a className="underline" href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Get an OpenRouter key</a>
        <form className="flex flex-col gap-3" onSubmit={async e => {
          e.preventDefault(); setBusy(true); setError("");
          try {
            const r = await fetch("/api/desktop-setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "provider", key }) });
            const j = await r.json(); if (!r.ok) throw Error(j.error || "Could not save your key.");
            setKey(""); setStatus(j);
          } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>
          <label htmlFor="openrouter-key">OpenRouter API key</label>
          <input id="openrouter-key" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} className="rounded-xl border p-3" required />
          <button disabled={busy || !key.trim()} className="rounded-full bg-ink p-3 text-white disabled:opacity-50">{busy ? "Connecting…" : "Connect OpenRouter"}</button>
        </form>
      </> : !status.model ? <>
        <h2 className="text-lg font-medium">2. Choose your model</h2>
        <p>Search the live catalog, including open-source model families such as Qwen, DeepSeek and GLM. Computer tasks need image input and tool support.</p>
        <ModelSettings />
        <button className="rounded-full bg-ink p-3 text-white disabled:opacity-50" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try {
            const r = await fetch("/api/models"); const info = await r.json();
            if (!r.ok) throw Error("Could not read your model choice.");
            const save = await fetch("/api/desktop-setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "model", model: info.defaultModel }) });
            const j = await save.json(); if (!save.ok) throw Error(j.error || "Could not save model."); setStatus(j);
          } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>Continue with selected model</button>
      </> : <>
        <h2 className="text-lg font-medium">4. Choose your Orgo computer</h2>
        <p>Connect a running Linux computer from your own Orgo account.</p>
        {main && state ? <AccountComputers state={state} bot={main} className="bg-desk" /> : <p>Loading your team…</p>}
      </>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!status && error && <button onClick={() => void refresh()}>Retry</button>}
    </main>
  </div>;
}
