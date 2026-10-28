/** Non-content connection evidence only; this does not populate the source list. */
export type ConnectionCause = "settings" | "not-found" | "permission" | "timeout" | "output-limit" | "failed" | "busy" | "compatibility";
export type ConnectionObservation = {
  version: string;
  observedAt: string;
  scope: "local-active-sources";
  sourceCount: number;
};
export type ConnectionResult =
  | { kind: "unconfigured"; cause: "settings" }
  | { kind: "failure"; cause: ConnectionCause }
  | { kind: "success"; observation: ConnectionObservation };
export type ConnectionState = { result: ConnectionResult; previous?: ConnectionObservation };
