"use client";

import { useRef, useState } from "react";
import type { SourceListResult, SourceListState, SourceSnapshot } from "../contracts/sources";

function checkedSnapshot(state: SourceListState): SourceSnapshot | undefined {
  if (state.kind === "success") return state.snapshot;
  return "previous" in state ? state.previous : undefined;
}

export function useSourceList(initialState: SourceListState, loadSources?: () => Promise<SourceListResult>) {
  const [stored, setStored] = useState({ seed: initialState, authority: initialState, value: initialState });
  let current = stored;
  if (stored.seed !== initialState) {
    const transient = initialState.kind === "failure" || initialState.kind === "unknown";
    current = transient ? { ...stored, seed: initialState, value: stored.value.kind === "loading" ? stored.value : { ...initialState, previous: checkedSnapshot(stored.value) } }
      : { seed: initialState, authority: initialState, value: initialState };
    setStored(current);
  }
  const state = current.value;
  const authority = current.authority;
  const active = useRef<{ authority: SourceListState } | null>(null);
  const snapshot = checkedSnapshot(state);

  async function refresh() {
    if (!loadSources || state.kind === "loading" || active.current?.authority === authority) return;
    const request = { authority };
    active.current = request;
    setStored(value => ({ ...value, value: { kind: "loading", previous: snapshot } }));
    const finish = (result: SourceListResult) => {
      if (active.current !== request) return;
      setStored(value => value.authority !== authority ? value : {
        ...value, value: result.kind === "failure" || result.kind === "unknown" ? { ...result, previous: snapshot } : result,
      });
    };
    try { finish(await loadSources()); }
    catch { finish({ kind: "failure", reason: "request-failed" }); }
    finally { if (active.current === request) active.current = null; }
  }

  return { state, snapshot, refresh };
}
