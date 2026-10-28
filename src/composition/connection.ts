import "server-only";
import type { ConnectionResult } from "@/contracts/connection";
import { checkConnection } from "@/adapters/gbrain";
import { getConnectionConfig } from "@/adapters/gbrain";

/** Configuration check only: rendering and builds never execute GBrain. */
export function getInitialConnection(): ConnectionResult | undefined {
  return getConnectionConfig() ? undefined : { kind: "unconfigured", cause: "settings" };
}
export async function checkConfiguredConnection(): Promise<ConnectionResult> {
  return checkConnection();
}
