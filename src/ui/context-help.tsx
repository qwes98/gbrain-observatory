"use client";

import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { sourceMessages, type Locale } from "../i18n/messages";

/** Native controls keep help available before hydration and without JavaScript. */
export function ContextHelp({ label, title, locale, children }: {
  label: string; title: string; locale: Locale; children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const reposition = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const button = trigger.current;
    const popover = panel.current;
    if (!button || !popover) return;
    function prepare(event: Event) {
      if ((event as ToggleEvent).newState !== "open") return;
      // Let native anchoring handle the first frame after a resize or scroll.
      delete popover!.dataset.positioned;
      popover!.style.removeProperty("max-height");
      popover!.style.removeProperty("max-width");
    }
    function place() {
      if (!popover!.matches(":popover-open")) return;
      const anchor = button!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 12;
      const topEdge = (viewport?.offsetTop ?? 0) + 12;
      const rightEdge = leftEdge + (viewport?.width ?? document.documentElement.clientWidth) - 24;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 24;
      let visibleLeft = leftEdge, visibleRight = rightEdge, visibleTop = topEdge, visibleBottom = bottomEdge;
      for (let ancestor = button!.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const bounds = ancestor.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
          visibleLeft = Math.max(visibleLeft, bounds.left + ancestor.clientLeft);
          visibleRight = Math.min(visibleRight, bounds.left + ancestor.clientLeft + ancestor.clientWidth);
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
          visibleTop = Math.max(visibleTop, bounds.top + ancestor.clientTop);
          visibleBottom = Math.min(visibleBottom, bounds.top + ancestor.clientTop + ancestor.clientHeight);
        }
      }
      if (!button!.getClientRects().length || anchor.bottom <= visibleTop || anchor.top >= visibleBottom || anchor.right <= visibleLeft || anchor.left >= visibleRight) {
        popover!.hidePopover();
        return;
      }
      popover!.style.maxWidth = `${Math.max(0, rightEdge - leftEdge)}px`;
      const below = bottomEdge - anchor.bottom - 8;
      const above = anchor.top - topEdge - 8;
      const naturalHeight = popover!.scrollHeight + 2;
      const downward = below >= naturalHeight || below >= above;
      popover!.style.maxHeight = `${Math.max(44, downward ? below : above)}px`;
      const bounds = popover!.getBoundingClientRect();
      const left = Math.max(leftEdge, Math.min(anchor.left, rightEdge - bounds.width));
      const top = Math.max(topEdge, Math.min(downward ? anchor.bottom + 8 : anchor.top - bounds.height - 8, bottomEdge - bounds.height));
      popover!.style.setProperty("--help-left", `${left}px`);
      popover!.style.setProperty("--help-top", `${top}px`);
      popover!.dataset.positioned = "true";
    }
    reposition.current = place;
    place();
    popover.addEventListener("beforetoggle", prepare);
    popover.addEventListener("toggle", place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    });
    observer.observe(popover);
    return () => {
      // A revoked data snapshot may remove its help; retain a reachable focus target.
      if (button === document.activeElement || (popover.matches(":popover-open") && popover.contains(document.activeElement))) {
        button.closest("main")?.focus();
      }
      reposition.current = null;
      observer.disconnect();
      cancelAnimationFrame(frame);
      popover.removeEventListener("beforetoggle", prepare);
      popover.removeEventListener("toggle", place);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, []);
  // React updates can move or hide an anchor without a scroll or resize event.
  useLayoutEffect(() => { reposition.current?.(); });

  return <>
    <button ref={trigger} type="button" className="context-help-trigger" popoverTarget={id} aria-label={label} aria-haspopup="dialog" aria-controls={id}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7" r=".8" fill="currentColor" stroke="none" /></svg>
    </button>
    <div ref={panel} id={id} popover="auto" className="context-help" role="dialog" aria-labelledby={`${id}-title`}>
      <div className="context-help-header"><h3 id={`${id}-title`}>{title}</h3><button type="button" className="context-help-close" popoverTarget={id} popoverTargetAction="hide" aria-label={sourceMessages[locale].close}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button></div>
      <div className="context-help-body">{children}</div>
    </div>
  </>;
}
