"use client";

import { Component, createRef, useActionState, useEffect, useRef } from "react";
import type { ConnectionResult } from "../contracts/connection";
import { sourceMessages, type Locale } from "../i18n/messages";
import { formatInstant } from "../i18n/time-zone";
import { useTimeZone } from "./time-zone-provider";

type ConnectionPanelProps = {
  locale: Locale;
  initial?: ConnectionResult;
  action: (previous: ConnectionResult | undefined) => Promise<ConnectionResult>;
};

export function ConnectionPanel(props: ConnectionPanelProps) {
  return <ConnectionBoundary {...props} />;
}

/** Keep action transport failures local without wrapping away the native server-action form. */
type BoundaryState = { failed: boolean; retry: boolean };

class ConnectionBoundary extends Component<ConnectionPanelProps, BoundaryState> {
  state = { failed: false, retry: false };
  private readonly container = createRef<HTMLDivElement>();
  static getDerivedStateFromError() { return { failed: true }; }
  getSnapshotBeforeUpdate(previousProps: ConnectionPanelProps, previousState: BoundaryState): boolean {
    void previousProps;
    return previousState.failed !== this.state.failed &&
      !!this.container.current?.contains(document.activeElement);
  }
  componentDidUpdate(previousProps: ConnectionPanelProps, previousState: BoundaryState, ownedFocus: boolean) {
    void previousProps;
    void previousState;
    if (ownedFocus) this.container.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }
  render() {
    const t = sourceMessages[this.props.locale].connectionCheck;
    const content = this.state.failed ? <section className="connection-panel" aria-labelledby="connection-title">
      <h2 id="connection-title">{t.title}</h2>
      <div role="status" aria-live="polite"><p>{t.causes.failed.reason}</p><p>{t.causes.failed.action}</p></div>
      <button type="button" onClick={() => this.setState({ failed: false, retry: true })}>{t.check}</button>
    </section> : <ConnectionForm {...this.props} retry={this.state.retry} />;
    return <div ref={this.container}>{content}</div>;
  }
}

function ConnectionForm({ locale, initial, action, retry }: ConnectionPanelProps & { retry: boolean }) {
  const [result, formAction, pending] = useActionState(action, initial);
  const submitted = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const retryRequested = useRef(false);
  useEffect(() => {
    if (retry && !retryRequested.current) {
      retryRequested.current = true;
      form.current?.requestSubmit();
    }
  }, [retry]);
  useEffect(() => { if (!pending) submitted.current = false; }, [pending]);
  const t = sourceMessages[locale].connectionCheck;
  const zone = useTimeZone();
  const observation = result?.kind === "success" ? result.observation : undefined;
  const time = observation && formatInstant(observation.observedAt, locale, zone);
  const issue = !pending && result && result.kind !== "success" ? t.causes[result.cause] : undefined;
  return <section className="connection-panel" aria-labelledby="connection-title">
    <h2 id="connection-title">{t.title}</h2>
    <form ref={form} aria-busy={pending} action={formAction} onSubmit={event => {
      if (pending || submitted.current) event.preventDefault();
      else submitted.current = true;
    }}><button type="submit" aria-disabled={pending}>{pending ? t.pending : t.check}</button></form>
    <div role="status" aria-live="polite" aria-atomic="true">
      {pending && <p>{t.pending}</p>}
      {observation && <>
        <p className="connection-result">{pending ? t.previous : t.success}</p>
        <dl><div><dt>{t.version}</dt><dd>{observation.version}</dd></div>
          <div><dt>{t.observedAt}</dt><dd><time dateTime={observation.observedAt}>{time ? `${time.text} · ${time.offset}` : sourceMessages[locale].invalidTime}</time> · {zone}</dd></div>
          <div><dt>{t.count}</dt><dd>{new Intl.NumberFormat(locale).format(observation.sourceCount)}</dd></div></dl>
        <p>{t.scope}</p>
      </>}
      {issue && <><p>{issue.reason}</p><p>{issue.action}</p></>}
      {!result && !pending && <p>{t.ready}</p>}
    </div>
    <p>{t.limitation}</p>
  </section>;
}
