import "server-only";
import { getState } from "./store";

/** Old default-team permission remains compatible; new independent computers start unapproved. */
export function macAccessAllowed() {
  return process.env.BOPS_DISABLE_MAC !== "1" && getState().mac?.accessEnabled === true;
}
