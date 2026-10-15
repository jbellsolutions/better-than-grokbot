import { keychainService } from "./instance";
import "server-only";
import { execFile, spawn } from "node:child_process";

/**
 * Secrets in the Mac's Keychain, under "Bops Vault" (this instance's: "Bops Vault <id>"). Values go
 * to `security` on stdin, hex-encoded, so they never show up in the process list; reading one back
 * only names the item. `service`: another item shared by every Bops on this Mac ("Bops Slack App").
 */
const SERVICE = keychainService();
const q = (s: string) => `"${s.replace(/["\\]/g, "")}"`;

export function setSecret(account: string, value: string, service = SERVICE) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn("security", ["-i"], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 && !err.trim() ? resolve() : reject(new Error(`Keychain refused it: ${err.trim() || code}`))));
    p.stdin.end(`add-generic-password -U -s ${q(service)} -a ${q(account)} -X ${Buffer.from(value, "utf8").toString("hex")}\n`);
  });
}

export function getSecret(account: string, service = SERVICE) {
  return new Promise<string | null>((resolve) =>
    execFile("security", ["find-generic-password", "-s", service, "-a", account, "-w"], (e, out) => resolve(e ? null : out.replace(/\n$/, ""))),
  );
}

export function deleteSecret(account: string, service = SERVICE) {
  return new Promise<void>((resolve) => execFile("security", ["delete-generic-password", "-s", service, "-a", account], () => resolve()));
}
