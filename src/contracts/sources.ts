/** Display contracts only: UI does not import GBrain clients or configuration. */
export interface Source {
  id: string;
  name: string;
  connection: { folder?: string; repository?: string };
  sync: { status: "success" | "attention" | "unknown"; label: string };
  lastSyncedAt: string | null;
  checkedAt: string | null;
}

export interface SourceSnapshot {
  sources: Source[];
  checkedAt: string;
}

export type SourceListResult =
  | { kind: "success"; snapshot: SourceSnapshot }
  | { kind: "unconfigured"; reason: "adapter-not-configured" }
  | { kind: "failure"; reason: "request-failed" }
  | { kind: "unknown"; reason: "unconfirmed" };

export type SourceListState =
  | SourceListResult
  | { kind: "loading"; previous?: SourceSnapshot }
  | { kind: "failure"; reason: "request-failed"; previous?: SourceSnapshot }
  | { kind: "unknown"; reason: "unconfirmed"; previous?: SourceSnapshot };
