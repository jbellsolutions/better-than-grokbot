import { dataPath, keychainService } from "./instance";
import "server-only";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Secrets in the Mac's Keychain, under "Bops Vault" (this instance's: "Bops Vault <id>"). Values go
 * to `security` on stdin, hex-encoded, so they never show up in the process list; reading one back
 * only names the item. `service`: another item shared by every Bops on this Mac ("Bops Slack App").
 *
 * Off a Mac (Windows, Linux) there's no Keychain: they go in .data/secrets.json, the same protection
 * as the keys in .env.local (on Linux only this user can read it; on Windows it's as private as its folder).
 */
const SERVICE = keychainService();
const q = (s: string) => `"${s.replace(/["\\]/g, "")}"`;
const ON_MAC = process.platform === "darwin";

/** Where secrets are kept, for the app to say so: the Keychain, or the private file. */
export const secretStore = (): "keychain" | "file" => (ON_MAC ? "keychain" : "file");

type Secrets = Record<string, Record<string, string>>;
const secretsFile = () => dataPath("secrets.json");
// One change at a time, so two saves can't each write the file without the other's secret.
let queue: Promise<unknown> = Promise.resolve();

async function readSecrets(): Promise<Secrets> {
  // No file yet is no secrets; a file that won't read throws, so a change never writes over it.
  const text = await readFile(secretsFile(), "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "{}";
    throw e;
  });
  return JSON.parse(text) as Secrets;
}

/** Change the file: written whole beside it, then moved into place, so a crash never leaves half a file. */
function changeSecrets(change: (all: Secrets) => void) {
  const done = queue.then(async () => {
    const all = await readSecrets();
    change(all);
    const file = secretsFile();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(all, null, 2), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    await chmod(file, 0o600).catch(() => {});
  });
  queue = done.catch(() => {});
  return done;
}

export function setSecret(account: string, value: string, service = SERVICE) {
  if (!ON_MAC) return changeSecrets((all) => void ((all[service] ??= {})[account] = value));
  return new Promise<void>((resolve, reject) => {
    const p = spawn("security", ["-i"], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 && !err.trim() ? resolve() : reject(new Error(`Keychain refused it: ${err.trim() || code}`))));
    p.stdin.end(`add-generic-password -U -s ${q(service)} -a ${q(account)} -X ${Buffer.from(value, "utf8").toString("hex")}\n`);
  });
}

export function getSecret(account: string, service = SERVICE): Promise<string | null> {
  if (!ON_MAC) return queue.then(readSecrets).then((all) => all[service]?.[account] ?? null, () => null);
  return new Promise<string | null>((resolve) =>
    execFile("security", ["find-generic-password", "-s", service, "-a", account, "-w"], (e, out) => resolve(e ? null : out.replace(/\n$/, ""))),
  );
}

export function deleteSecret(account: string, service = SERVICE): Promise<void> {
  if (!ON_MAC) return changeSecrets((all) => void delete all[service]?.[account]).catch(() => {});
  return new Promise<void>((resolve) => execFile("security", ["delete-generic-password", "-s", service, "-a", account], () => resolve()));
}
