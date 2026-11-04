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
export const navigationQueryLimit = 2048;
export interface PageNavigation {
  slug: string;
  view: "memories" | "body" | "references";
  mode: "panel" | "full";
}
export interface FactNavigation { loaded: boolean; id: string | null; mode: "panel" | "full" }
export function boundedFactId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,127}$/.test(value);
}
export function parseFactNavigation(query: URLSearchParams): FactNavigation {
  const loaded = query.getAll("facts"), ids = query.getAll("fact"), modes = query.getAll("factReading");
  const valid = ids.length === 1 && boundedFactId(ids[0]) && modes.length <= 1 && (!modes.length || modes[0] === "full" || modes[0] === "panel");
  return { loaded: loaded.length === 1 && loaded[0] === "1" || valid, id: valid ? ids[0] : null, mode: valid && modes[0] === "full" ? "full" : "panel" };
}
/** URLs contain bounded identity and view only; never source content or claim offsets. */
export function boundedPageSlug(value: unknown): value is string {
  if (typeof value !== "string" || !value.length || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    // Reject invalid Unicode, then measure the serializer used by generated links.
    encodeURIComponent(value);
    return new URLSearchParams({ page: value }).toString().length <= "page=".length + 768;
  } catch { return false; }
}
export function parsePageNavigation(query: URLSearchParams): PageNavigation | null {
  const pages = query.getAll("page"), views = query.getAll("view"), modes = query.getAll("reading");
  if (pages.length !== 1 || !boundedPageSlug(pages[0]) || views.length > 1 || modes.length > 1) return null;
  const view = views[0] ?? "memories", mode = modes[0] ?? "panel";
  if (!["memories", "body", "references"].includes(view) || !["panel", "full"].includes(mode)) return null;
  return { slug: pages[0], view: view as PageNavigation["view"], mode: mode as PageNavigation["mode"] };
}
export function boundedSourceReference(value: string): boolean {
  try {
    encodeURIComponent(value);
    return value.length <= 256 && new URLSearchParams({ source: value }).toString().length <= "source=".length + 256 && validSourceReference(value);
  } catch { return false; }
}
/** Keep navigation small enough for ordinary request lines and same-origin referrers. */
export function sourceNavigationParameters(selected: string | null, expanded: string[], added: string = "all", detail?: PageNavigation | null, fact?: FactNavigation | null): URLSearchParams {
  const result = new URLSearchParams();
  if (selected !== null && boundedSourceReference(selected)) result.set("source", selected);
  if (added === "today" || added === "yesterday") result.set("added", added);
  const branches = new URLSearchParams();
  for (const value of new Set(expanded)) {
    if (!boundedSourceReference(value)) continue;
    const next = new URLSearchParams(branches);
    next.append("expanded", value);
    // Reserve the maximum encoded selection and date condition so links keep every branch.
    if (next.toString().length > expansionQueryLimit - 280) break;
    branches.append("expanded", value);
    result.append("expanded", value);
  }
  if (selected !== null && boundedSourceReference(selected) && detail && boundedPageSlug(detail.slug)) {
    result.set("page", detail.slug);
    if (detail.view === "body" || detail.view === "references") result.set("view", detail.view);
    if (detail.mode === "full") result.set("reading", "full");
  }
  if (selected !== null && boundedSourceReference(selected) && fact) {
    if (fact.loaded) result.set("facts", "1");
    if (fact.id !== null && boundedFactId(fact.id)) {
      result.set("fact", fact.id);
      if (fact.mode === "full") result.set("factReading", "full");
    }
  }
  while (result.toString().length > navigationQueryLimit && result.has("expanded")) {
    const retained = result.getAll("expanded").slice(0, -1); result.delete("expanded");
    for (const branch of retained) result.append("expanded", branch);
  }
  return result;
}
export function sourceNavigationPath(selected: string | null, expanded: string[], added: string = "all", detail?: PageNavigation | null, fact?: FactNavigation | null): string {
  const query = sourceNavigationParameters(selected, expanded, added, detail, fact).toString();
  return query ? `/?${query}` : "/";
}
export const pageNavigationPath = sourceNavigationPath;
export function validatedSourceReturn(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || value.length > navigationQueryLimit + 32 || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://internal.invalid");
    if (url.pathname !== "/" || url.origin !== "https://internal.invalid") return "/";
    const selected = url.searchParams.getAll("source");
    const added = url.searchParams.getAll("added");
    return sourceNavigationPath(selected.length === 1 ? selected[0] : null, url.searchParams.getAll("expanded"), added.length === 1 ? added[0] : "all", parsePageNavigation(url.searchParams), parseFactNavigation(url.searchParams));
  } catch { return "/"; }
}
