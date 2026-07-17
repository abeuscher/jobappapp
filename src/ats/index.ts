import type { AtsAdapter } from "../types.js";
import { ashbyAdapter } from "./ashby.js";
import { greenhouseAdapter } from "./greenhouse.js";
import { leverAdapter } from "./lever.js";

/** Adapter registry. Add new ATS support here behind the same interface. */
export const adapters: AtsAdapter[] = [greenhouseAdapter, leverAdapter, ashbyAdapter];

export function detectAdapter(url: string): AtsAdapter | undefined {
  return adapters.find((a) => a.matches(url));
}
