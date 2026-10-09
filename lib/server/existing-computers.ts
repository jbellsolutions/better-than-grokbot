import { instanceId, instanceComputer } from "./instance";
import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { live, sharesComputer, workspaceOf } from "@/lib/types";
import { bot, getState, update } from "./store";
import { orgo, OrgoError, type OrgoScreen } from "./orgo";
import { sameComputer } from "./screens";

/** Older ordinary desktops have a default screenshot, but no Bops multi-screen endpoint. */
export async function observedScreens(computerId: string): Promise<OrgoScreen[]> {
  try { return await orgo.screens(computerId); }
  catch (e) {
    if (!(e instanceof OrgoError) || e.status !== 404) throw e;
    return [{ id: "default", display: "default", width: 0, height: 0, default: true }];
  }
}

/** Selecting an existing VM never creates, deletes, resizes, or powers a VM on. */
export async function assignComputer(botId: string, computerId: string): Promise<{ ok: true } | { error: string }> {
  if (instanceId() !== "default" && computerId !== instanceComputer()) return { error: "This instance is bound to its business computer. Switch app instances to use another computer." };
  const b = bot(botId);
  if (!b) return { error: "No such agent." };
  if (typeof computerId !== "string" || !/^[a-f0-9-]{36}$/i.test(computerId)) return { error: "Choose a computer from your Orgo account." };
  if (b.computerId === computerId) return { ok: true };
  if (b.computerStatus === "cloning") return { error: "Wait for computer setup to finish first." };
  // Managed clones have a separate, explicit deletion flow; switching must never silently delete one.
  if (b.computerId && !b.externalComputer && b.computerId !== process.env.BOPS_ORGO_COMPUTER_ID)
    return { error: "Move this agent to Shared first to review what happens to its Bops-created computer." };
  let c;
  try { c = (await orgo.computers()).find((x) => x.id === computerId); }
  catch { return { error: "Could not read your Orgo account. Check the connection and retry." }; }
  if (!c) return { error: "That computer is not available in your Orgo account." };
  if (c.os !== "linux") return { error: "Bops currently supports Linux Orgo computers." };
  if (c.status !== "running") return { error: "Start this computer in Orgo first, then refresh the list." };
  const st = getState();
  if (bot(botId) !== b || (b.computerStatus as string) === "cloning") return { error: "The agent changed during selection. Retry." };
  const moving = st.bots.filter((x) => x.id === b.id || (b.isMain && workspaceOf(x) === workspaceOf(b) && sharesComputer(x)));
  const affected = (id: string) => moving.some((x) => x.id === id) || !!st.bots.find((x) => x.id === id && sameComputer(x.id, st.bots.find((y) => y.computerId === computerId)?.id ?? ""));
  const working = st.sessions.find((s) => affected(s.botId) && live(s) && s.runsOn !== "mac");
  if (working) return { error: "Pause cloud tasks on these computers before switching." };
  if (st.watches?.some((w) => affected(w.botId) && !w.mac) || (st.takeover && affected(st.takeover.botId)))
    return { error: "Stop screen watching and hand back any screens before switching." };
  const host = st.bots.find((x) => x.computerId === computerId);
  if (host?.computerStatus === "cloning") return { error: "This computer is being set up. Try again shortly." };
  update((state) => {
    b.computerId = c.id;
    b.computerName = c.name;
    b.computerRam = c.ram;
    b.externalComputer = true;
    b.freeComputer = undefined;
    b.computer = "own";
    b.computerStatus = host?.computerStatus === "ready" ? "ready" : "none";
    b.tailnet = host?.tailnet;
    for (const x of moving) for (const key of Object.keys(state.screens ?? {}))
      if (key.startsWith(`${x.id}:`)) delete state.screens![key];
  });
  return { ok: true };
}

/** Install the existing repo's runtime on a user-selected Ubuntu VM, on its first task. */
export async function prepareComputer(computerId: string) {
  const files = [
    ["vm/screen_mcp.py", "/opt/bops/screen_mcp.py"],
    ["vm/openrouter-tools.py", "/opt/bops/openrouter-tools.py"],
    ["vm/bops-home.py", "/opt/bops/bops-home.py"],
    ["vm/browser-front.cjs", "/opt/bops/pw/front.cjs"],
    ...["bops-chrome", "bops-screens", "bops-desktop", "bops-reset-screen", "bops-keep-screens", "bops-seed-profiles", "bops-tailnet"].map((n) => [`vm/bin/${n}`, `/usr/local/bin/${n}`]),
  ];
  const manifest = files.map(([from, to]) => ({ path: to, data: readFileSync(join(process.cwd(), from)).toString("base64") }));
  const payload = Buffer.from(JSON.stringify(manifest)).toString("base64");
  const command = `set -eu
if [ -f /opt/bops/selfhost-runtime-v1 ]; then exit 0; fi
[ "$(id -u)" = 0 ] || { echo 'Bops setup requires the Orgo root environment.'; exit 1; }
command -v node >/dev/null && command -v npm >/dev/null && [ -x /usr/bin/google-chrome-stable ] || { echo 'This computer needs Node, npm and Chrome before Bops can use it.'; exit 1; }
[ "$(df -Pk / | awk 'NR==2 {print $4}')" -gt 2000000 ] || { echo 'Bops needs 2 GB of free disk space.'; exit 1; }
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv jq rsync xdotool scrot hsetroot plank libglib2.0-bin
mkdir -p /opt/bops/pw /opt/bops/desktop /workspace /root/profiles /root/.bops /var/log/bops
chmod 700 /root/.bops
[ -x /opt/bops/venv/bin/python ] || python3 -m venv /opt/bops/venv
/opt/bops/venv/bin/pip install -q 'mcp==1.26.0'
npm install --prefix /opt/bops/pw --no-audit --no-fund --silent '@playwright/mcp@0.0.83'
python3 - <<'PY'
import json,base64,pathlib
for f in json.loads(base64.b64decode('${payload}')):
 p=pathlib.Path(f['path']);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(base64.b64decode(f['data']));p.chmod(0o755 if '/bin/' in str(p) else 0o644)
PY
/opt/bops/venv/bin/python -c 'import mcp'
node -e "require('/opt/bops/pw/node_modules/@playwright/mcp/package.json')"
touch /opt/bops/selfhost-runtime-v1`;
  const r = await orgo.bash(computerId, command, 600);
  if (r.exit_code !== 0) throw new Error(`Bops runtime setup failed. ${r.output.slice(-600)}`);
}
