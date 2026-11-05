import "server-only";
import { spawn } from "node:child_process";

// Windows DPAPI binds ciphertext to this Windows login. Credentials travel on stdin, never argv.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$r = [Console]::In.ReadToEnd() | ConvertFrom-Json
$hash = [System.Security.Cryptography.SHA256]::Create()
$id = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($r.account))).Replace('-', '')
$dir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Better Than GrokBot Vault'
$file = Join-Path $dir ($id + '.bin')
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($r.op -eq 'set') {
  [IO.Directory]::CreateDirectory($dir) | Out-Null
  $bytes = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($r.value), $null, $scope)
  $tmp = $file + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  try {
    [IO.File]::WriteAllBytes($tmp, $bytes)
    Move-Item -LiteralPath $tmp -Destination $file -Force
  } finally {
    if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) }
  }
} elseif ($r.op -eq 'get' -and [IO.File]::Exists($file)) {
  $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($file), $null, $scope)
  [Console]::Write([Convert]::ToBase64String($bytes))
} elseif ($r.op -eq 'delete' -and [IO.File]::Exists($file)) {
  [IO.File]::Delete($file)
}
`;
export function windowsSecret(op: "set" | "get" | "delete", account: string, value?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Windows credential store timed out.")); }, 15_000);
    child.stdout.on("data", (b: Buffer) => { out += b.toString(); });
    // PowerShell errors can contain input: never put them into app logs or API responses.
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new Error("Windows credential store could not start.")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("Windows credential store failed."));
      else resolve(out.trim() ? Buffer.from(out.trim(), "base64").toString("utf8") : null);
    });
    // ASCII JSON avoids Windows PowerShell's legacy stdin code page corrupting Unicode.
    child.stdin.end(JSON.stringify({ op, account, value }).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`));
  });
}
