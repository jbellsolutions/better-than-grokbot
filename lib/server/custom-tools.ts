import "server-only";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dataPath } from "./instance";
import { bot } from "./store";
import type { ToolConnection } from "@/lib/tool-connections";

export type ConnectedTool = { name: string; description: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string> };
const MAX_OUTPUT = 64000;
const sessions = new Map<string, { sessionId?: string; protocol: string; until: number; tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[] }>();
export function toolConnections(botId: string): ToolConnection[] {
  try { return (JSON.parse(readFileSync(dataPath("tool-connections.json"), "utf8")) as ToolConnection[]).filter(t => t.botId === botId); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

export function saveTool(botId: string, input: Partial<ToolConnection>) {
  if (process.env.BOPS_SELF_HOSTED !== "1") throw Error("Custom tools are configured on self-hosted coordinators.");
  if (!bot(botId)) throw Error("No such agent.");
  if (!input.name || !/^[a-z][a-z0-9_]{0,39}$/.test(input.name)) throw Error("Use a tool name with lowercase letters, numbers and underscores.");
  if (!input.description?.trim() || input.description.length > 2000) throw Error("Describe what the tool does (up to 2,000 characters).");
  if (!["api", "cli", "mcp"].includes(input.kind ?? "")) throw Error("Choose API, CLI or MCP.");
  if (input.tokenEnv && !/^[A-Z][A-Z0-9_]{0,100}$/.test(input.tokenEnv)) throw Error("Use an environment variable name for the token.");
  if (input.kind !== "cli") {
    const url = new URL(input.url ?? "");
    if (url.username || url.password || url.hash || url.search) throw Error("Keep credentials and query parameters out of the tool endpoint.");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw Error("Use HTTPS, or HTTP on localhost.");
  } else {
    if (!input.command?.trim() || input.command.length > 1000 || /[\r\n\0]/.test(input.command)) throw Error("Specify an executable, with its fixed arguments separately.");
    if (!Array.isArray(input.args) || input.args.length > 100 || input.args.some(a => typeof a !== "string" || a.length > 4000 || a.includes("\0"))) throw Error("CLI arguments must be a JSON array of strings.");
  }
  const inputSchema = input.kind === "mcp" ? { type: "object", properties: {} } : input.inputSchema;
  if (!inputSchema || inputSchema.type !== "object" || JSON.stringify(inputSchema).length > 16000) throw Error("Specify a JSON input schema with type object (up to 16,000 characters).");
  const all = readAll();
  if (all.some(t => t.botId === botId && t.name === input.name && t.id !== input.id)) throw Error("This agent already has a connection with that name.");
  if (all.filter(t => t.botId === botId).length >= 20 && !input.id) throw Error("An agent can have up to 20 tool connections.");
  const existing = input.id && all.find(t => t.id === input.id && t.botId === botId);
  if (input.id && !existing) throw Error("No such connection.");
  const connection: ToolConnection = { id: existing ? existing.id : randomUUID(), botId, name: input.name, description: input.description.trim(), kind: input.kind!, inputSchema,
    ...(input.kind === "cli" ? { command: input.command, args: input.args } : { url: input.url, tokenEnv: input.tokenEnv || undefined }) };
  writeAll([...all.filter(t => t.id !== connection.id), connection]);
  sessions.delete(connection.id);
  return connection;
}
function readAll(): ToolConnection[] {
  try { return JSON.parse(readFileSync(dataPath("tool-connections.json"), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
}
function writeAll(connections: ToolConnection[]) {
  mkdirSync(dataPath(), { recursive: true, mode: 0o700 });
  const path = dataPath("tool-connections.json");
  writeFileSync(`${path}.tmp`, JSON.stringify(connections), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
export function deleteTool(botId: string, id: string) {
  if (process.env.BOPS_SELF_HOSTED !== "1") throw Error("Custom tools require self-hosting.");
  writeAll(readAll().filter(t => t.botId !== botId || t.id !== id));
  sessions.delete(id);
}

/** Remove connections with the agent so reusing its ID never inherits the old tools. */
export function deleteAgentTools(botId: string) {
  const all = readAll();
  const removed = all.filter(t => t.botId === botId);
  if (!removed.length) return;
  writeAll(all.filter(t => t.botId !== botId));
  for (const tool of removed) sessions.delete(tool.id);
}

function headers(c: ToolConnection): Record<string, string> {
  const token = c.tokenEnv ? process.env[c.tokenEnv] : undefined;
  if (c.tokenEnv && !token) throw Error(`Configure ${c.tokenEnv} on the coordinator before using this connection.`);
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
async function boundedText(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > MAX_OUTPUT) throw Error("Tool output exceeded 64 KB. Return a shorter result.");
    }
  } finally { await reader.cancel().catch(() => {}); }
}
async function rpc(c: ToolConnection, method: string, params: unknown, sessionId?: string, protocol = "2025-11-25", parent?: AbortSignal) {
  const signal = parent ? AbortSignal.any([parent, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
  const id = randomUUID();
  const notification = method.startsWith("notifications/");
  const response = await fetch(c.url!, { method: "POST", redirect: "error", signal,
    headers: { ...headers(c), Accept: "application/json, text/event-stream", ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}), ...(method !== "initialize" ? { "MCP-Protocol-Version": protocol } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }) });
  if (!response.ok) throw Error(`MCP request failed (${response.status}). Reconnect the tool if its session expired.`);
  if (notification) { await response.body?.cancel(); return { result: {}, sessionId }; }
  // SSE responses can stay open after the matching RPC answer; stop reading as soon as it arrives.
  let answer: { result?: Record<string, unknown>; error?: { message: string } } | undefined;
  if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = "", size = 0;
    try {
      while (!answer) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_OUTPUT) throw Error("MCP output exceeded 64 KB.");
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = frame.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
          if (data) { const parsed = JSON.parse(data); if (parsed.id === id) answer = parsed; }
        }
      }
    } finally { await reader.cancel().catch(() => {}); }
  } else {
    const parsed = JSON.parse(await boundedText(response, signal));
    if (parsed.id === id) answer = parsed;
  }
  if (!answer) throw Error("MCP server did not return the requested answer.");
  if (answer.error) throw Error(answer.error.message);
  return { result: answer.result ?? {}, sessionId: response.headers.get("Mcp-Session-Id") ?? sessionId };
}
async function mcpTools(c: ToolConnection) {
  const existing = sessions.get(c.id);
  if (existing && existing.until > Date.now()) return existing;
  const initialized = await rpc(c, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "better-than-grokbot", version: "0.0.6" } });
  const protocol = String(initialized.result.protocolVersion ?? "2025-11-25");
  await rpc(c, "notifications/initialized", {}, initialized.sessionId, protocol);
  const tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const listed = await rpc(c, "tools/list", cursor ? { cursor } : {}, initialized.sessionId, protocol);
    if (!Array.isArray(listed.result.tools)) throw Error("MCP returned an invalid tool catalog.");
    tools.push(...listed.result.tools);
    cursor = listed.result.nextCursor as string | undefined;
    if (!cursor) break;
  }
  const session = { sessionId: initialized.sessionId, protocol, until: Date.now() + 300000, tools };
  sessions.set(c.id, session);
  return session;
}
function cli(c: ToolConnection, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(c.command!, c.args ?? [], { shell: false, cwd: process.cwd(), env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, TMPDIR: process.env.TMPDIR }, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", failed = false;
    const fail = (error: Error) => { failed = true; child.kill("SIGKILL"); reject(error); };
    const timer = setTimeout(() => fail(Error("CLI tool timed out after 30 seconds.")), 30000);
    const abort = () => fail(Error("Tool call stopped."));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", chunk => { output += chunk; if (output.length > MAX_OUTPUT) fail(Error("CLI output exceeded 64 KB.")); });
    // Tool stderr can contain credentials; report an exit code, not raw diagnostics.
    child.stderr.resume();
    child.on("error", fail);
    child.on("close", code => { clearTimeout(timer); signal?.removeEventListener("abort", abort); if (!failed) { if (code === 0) resolve(output || "Done."); else reject(Error(`CLI tool exited with status ${code}.`)); } });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(args) + "\n");
  });
}

export async function connectedTools(botId: string): Promise<ConnectedTool[]> {
  if (process.env.BOPS_SELF_HOSTED !== "1") return [];
  const tools: ConnectedTool[] = [];
  for (const c of toolConnections(botId)) {
    try {
    const current = () => {
      if (!toolConnections(botId).some(t => JSON.stringify(t) === JSON.stringify(c))) throw Error("This tool connection was removed or changed. Start a new turn.");
    };
    if (c.kind === "mcp") {
      const session = await mcpTools(c);
      for (const [i, t] of session.tools.entries()) tools.push({ name: `custom_${c.name}_${i}`, description: `${c.description}: ${t.description ?? t.name}`, parameters: t.inputSchema,
        run: async (args, signal) => { current(); const answer = await rpc(c, "tools/call", { name: t.name, arguments: args }, session.sessionId, session.protocol, signal); return JSON.stringify(answer.result); } });
    } else tools.push({ name: `custom_${c.name}`, description: c.description, parameters: c.inputSchema, run: async (args, parent) => {
      current();
      if (c.kind === "cli") return cli(c, args, parent);
      const signal = parent ? AbortSignal.any([parent, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
      const response = await fetch(c.url!, { method: "POST", redirect: "error", headers: headers(c), body: JSON.stringify(args), signal });
      if (!response.ok) throw Error(`API tool failed (${response.status}).`);
      return boundedText(response, signal);
    } });
    } catch (e) {
      const message = `Connection ${c.name} is unavailable: ${(e as Error).message}`;
      tools.push({ name: `custom_${c.name}_unavailable`, description: message, parameters: { type: "object", properties: {}, required: [] }, run: async () => { throw Error(message); } });
    }
  }
  return tools;
}
