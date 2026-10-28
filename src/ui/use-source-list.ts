"use client";

import { useRef, useState } from "react";
import type { SourceListResult, SourceListState, SourceSnapshot } from "../contracts/sources";

function checkedSnapshot(state: SourceListState): SourceSnapshot | undefined {
  if (state.kind === "success") return state.snapshot;
  return "previous" in state ? state.previous : undefined;
}

export function useSourceList(initialState: SourceListState, loadSources?: () => Promise<SourceListResult>) {
  const [state, setState] = useState(initialState);
  const inFlight = useRef(false);
  const snapshot = checkedSnapshot(state);

  async function refresh() {
    if (!loadSources || inFlight.current || state.kind === "loading") return;
    inFlight.current = true;
    setState({ kind: "loading", previous: snapshot });
    try {
      const result = await loadSources();
      if (result.kind === "failure" || result.kind === "unknown") {
        setState({ ...result, previous: snapshot });
      } else {
        setState(result);
      }
    } catch {
      // Raw errors may include private paths, addresses, or credentials.
      setState({ kind: "failure", reason: "request-failed", previous: snapshot });
    } finally {
      inFlight.current = false;
    }
  }

  return { state, snapshot, refresh };
}
