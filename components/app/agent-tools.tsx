"use client";
import { useEffect, useState } from "react";
import type { Bot } from "@/lib/types";
import type { ToolConnection } from "@/lib/tool-connections";

export function AgentTools({ bot }: { bot: Bot }) {
  const [connections, setConnections] = useState<ToolConnection[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<ToolConnection["kind"]>("api");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [args, setArgs] = useState("[]");
  const [tokenEnv, setTokenEnv] = useState("");
  const [schema, setSchema] = useState('{"type":"object","properties":{},"required":[],"additionalProperties":false}');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const load = async () => {
    const res = await fetch(`/api/tools?botId=${encodeURIComponent(bot.id)}`);
    const data = await res.json();
    if (!res.ok) throw Error(data.error || "Could not load tools.");
    setConnections(data.connections); setEnabled(data.selfHosted);
  };
  useEffect(() => { let disposed = false; void fetch(`/api/tools?botId=${encodeURIComponent(bot.id)}`).then(async res => {
    const data = await res.json(); if (!res.ok) throw Error(data.error || "Could not load tools.");
    if (!disposed) { setConnections(data.connections); setEnabled(data.selfHosted); }
  }).catch(e => { if (!disposed) setError(e.message); }); return () => { disposed = true; }; }, [bot.id]);
  const act = async (body: unknown, method = "POST") => {
    setBusy(true); setError(""); setResult("");
    try {
      const res = await fetch("/api/tools", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json(); if (!res.ok) throw Error(data.error || "Tool configuration failed.");
      await load();
      if (data.tools) setResult(`Available: ${data.tools.map((t: { name: string }) => t.name).join(", ") || "none"}`);
      else if (method === "POST") { setEditing(false); setName(""); setDescription(""); setEndpoint(""); setResult("Connection saved. Your next turn can use it."); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const input = "w-full rounded-lg bg-white px-3 py-2 text-[13px] text-ink shadow-[0_0_0_1px_#00000015]";
  if (!enabled && !error) return null;
  return <div className="flex w-full flex-col gap-2 rounded-2xl bg-white/70 p-4">
    <div className="flex justify-between text-[13px] font-semibold"><span>Tools and connections</span>{enabled && <button onClick={() => setEditing(!editing)} className="text-[12px] underline">{editing ? "Close" : "+ Add tool"}</button>}</div>
    <span className="text-[12px] leading-4 text-[#6B6B6B]">Connect tools this agent may use for your tasks. API and CLI tools accept JSON arguments. MCP connections discover their tools automatically.</span>
    {connections.map(c => <div key={c.id} className="flex items-center gap-2 rounded-xl bg-white p-2.5 text-[12px]">
      <span className="min-w-0 flex-1"><b>{c.name}</b> · {c.kind.toUpperCase()}<span className="block truncate text-[#6B6B6B]">{c.description}</span></span>
      <button disabled={busy} aria-label={`Remove ${c.name}`} onClick={() => void act({ botId: bot.id, id: c.id }, "DELETE")} className="text-[#B42318]">Remove</button>
    </div>)}
    {!!connections.length && <button disabled={busy} onClick={() => void act({ botId: bot.id, test: true })} className="self-start text-[12px] underline">{busy ? "Checking…" : "Check available tools"}</button>}
    {editing && <form className="flex flex-col gap-2" onSubmit={event => {
      event.preventDefault();
      try { void act({ botId: bot.id, connection: { kind, name, description, ...(kind === "cli" ? { command: endpoint, args: JSON.parse(args) } : { url: endpoint, tokenEnv }), inputSchema: JSON.parse(schema) } }); }
      catch (e) { setError(`Invalid JSON: ${(e as Error).message}`); }
    }}>
      <select aria-label="Connection type" value={kind} onChange={e => setKind(e.target.value as typeof kind)} className={input}><option value="api">API · JSON POST</option><option value="cli">CLI · JSON stdin</option><option value="mcp">MCP · Streamable HTTP</option></select>
      <input required aria-label="Tool name" placeholder="Tool name, e.g. search_crm" value={name} onChange={e => setName(e.target.value)} className={input} />
      <textarea required aria-label="Tool description" placeholder="What this tool does and when to use it" value={description} onChange={e => setDescription(e.target.value)} className={input} />
      <input required aria-label={kind === "cli" ? "Executable" : "Tool endpoint"} placeholder={kind === "cli" ? "Executable, e.g. /usr/local/bin/crm-tool" : "https://your-service.example/tools"} value={endpoint} onChange={e => setEndpoint(e.target.value)} className={input} />
      {kind === "cli" ? <textarea aria-label="Fixed CLI arguments" value={args} onChange={e => setArgs(e.target.value)} className={`${input} font-mono`} /> : <input aria-label="Token environment variable" placeholder="Token environment variable (optional), e.g. CRM_API_KEY" value={tokenEnv} onChange={e => setTokenEnv(e.target.value)} className={input} />}
      {kind !== "mcp" && <label className="text-[12px] text-[#6B6B6B]">JSON input schema<textarea aria-label="JSON input schema" rows={4} value={schema} onChange={e => setSchema(e.target.value)} className={`${input} mt-1 font-mono`} /></label>}
      <button disabled={busy} className="self-start rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-white">{busy ? "Saving…" : "Save connection"}</button>
    </form>}
    {error && <span role="alert" className="text-[12px] text-[#B42318]">{error}</span>}
    {result && <span role="status" className="text-[12px] text-[#067647]">{result}</span>}
  </div>;
}
