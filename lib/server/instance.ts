import { join, resolve } from "node:path";
import { homedir } from "node:os";

/** A coordinator owns one instance for its entire lifetime. Never swap its state or keys. */
export function instanceId() {
  const id = process.env.BOPS_INSTANCE_ID || "default";
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) throw new Error("Invalid Bops instance ID");
  return id;
}

export const dataDir = () => resolve(process.env.BOPS_DATA_DIR || join(process.cwd(), ".data"));
export const dataPath = (...parts: string[]) => join(dataDir(), ...parts);
export const instanceName = () => process.env.BOPS_INSTANCE_NAME || "Current Bops";
export const instanceComputer = () => process.env.BOPS_ORGO_COMPUTER_ID;
export const registryPath = () => process.env.BOPS_INSTANCE_REGISTRY || join(process.cwd(), ".data", "instances.json");
export const keychainService = () => instanceId() === "default" ? "Bops Vault" : `Bops Vault ${instanceId()}`;
export const localHome = () => instanceId() === "default" ? join(homedir(), ".bops") : dataPath("local");
export const localPortBase = () => Number(process.env.BOPS_CDP_PORT_BASE || 9300);
export const instanceInfo = () => ({ id: instanceId(), name: instanceName(), computerId: instanceComputer() || null });
