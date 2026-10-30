/** Display contracts only: UI does not import GBrain clients or configuration. */
export interface Source {
  namespace: string;
  federated: boolean;
  strategy: string | null;
  pageCount: number;
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
  scope: "returned-active-sources";
  coverage: "unknown";
}

export type SourceListResult =
  | { kind: "success"; snapshot: SourceSnapshot }
  | { kind: "unconfigured"; reason: "adapter-not-configured" }
  | { kind: "denied"; reason: "access-denied" }
  | { kind: "failure"; reason: "request-failed" | "busy" }
  | { kind: "unknown"; reason: "unconfirmed" | "unsupported" };

export type SourceListState =
  | SourceListResult
  | { kind: "loading"; previous?: SourceSnapshot }
  | { kind: "failure"; reason: "request-failed" | "busy"; previous?: SourceSnapshot }
  | { kind: "unknown"; reason: "unconfirmed" | "unsupported"; previous?: SourceSnapshot };

/** Structural encoding keeps connection and Source identity separate, including punctuation. */
export function sourceReference(source: Pick<Source, "namespace" | "id">): string {
  return JSON.stringify([source.namespace, source.id]);
}
export function validSourceReference(value: string): boolean {
  try {
    const pair: unknown = JSON.parse(value);
    return Array.isArray(pair) && pair.length === 2 && pair.every(part => typeof part === "string" && part.length > 0) && JSON.stringify(pair) === value;
  } catch { return false; }
}

export const expansionQueryLimit = 1024;
export function boundedSourceReference(value: string): boolean {
  return value.length <= 256 && encodeURIComponent(value).length <= 256 && validSourceReference(value);
}
/** Keep navigation small enough for ordinary request lines and same-origin referrers. */
export function sourceNavigationParameters(selected: string | null, expanded: string[]): URLSearchParams {
  const result = new URLSearchParams();
  if (selected !== null && boundedSourceReference(selected)) result.set("source", selected);
  const branches = new URLSearchParams();
  for (const value of new Set(expanded)) {
    if (!boundedSourceReference(value)) continue;
    const next = new URLSearchParams(branches);
    next.append("expanded", value);
    // Reserve the maximum encoded selection plus its key/separator so links keep every branch.
    if (next.toString().length > expansionQueryLimit - 264) break;
    branches.append("expanded", value);
    result.append("expanded", value);
  }
  return result;
}
export function sourceNavigationPath(selected: string | null, expanded: string[]): string {
  const query = sourceNavigationParameters(selected, expanded).toString();
  return query ? `/?${query}` : "/";
}
export function validatedSourceReturn(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || value.length > expansionQueryLimit + 2 || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://internal.invalid");
    if (url.pathname !== "/" || url.origin !== "https://internal.invalid") return "/";
    const selected = url.searchParams.getAll("source");
    return sourceNavigationPath(selected.length === 1 ? selected[0] : null, url.searchParams.getAll("expanded"));
  } catch { return "/"; }
}
