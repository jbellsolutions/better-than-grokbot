const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Directory junctions work on Windows without Developer Mode or administrator rights.
// Copy top-level files: Windows file symlinks require extra privileges. Refresh on each launch
// so an upgrade cannot retain the previous server entrypoint. State stays in .data.
function linkServer(dir, home) {
  fs.mkdirSync(path.join(home, ".data"), { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (name === ".data" || name.startsWith(".env")) continue;
    const target = path.join(dir, name);
    const dest = path.join(home, name);
    const st = fs.lstatSync(dest, { throwIfNoEntry: false });
    if (st?.isSymbolicLink()) fs.unlinkSync(dest);
    if (fs.statSync(target).isDirectory()) {
      if (st && !st.isSymbolicLink()) throw new Error(`Remove the unexpected directory ${dest} before upgrading Better Than GrokBot.`);
      fs.symlinkSync(target, dest, process.platform === "win32" ? "junction" : "dir");
    } else {
      fs.copyFileSync(target, dest);
    }
  }
}
function stopProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-pid, "SIGTERM");
  } catch { /* already exited */ }
}
module.exports = { linkServer, stopProcessTree };
