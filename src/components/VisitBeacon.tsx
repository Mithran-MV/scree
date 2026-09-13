"use client";

import { useEffect } from "react";

/** Sent once per page load, even when React mounts twice in development. */
let sent = false;

/**
 * One view, sent to the server's private count. Nothing is stored in the
 * browser; the owner can opt their own browser out from the stats page.
 */
export function VisitBeacon() {
  useEffect(() => {
    if (sent) return;
    sent = true;
    try {
      if (window.localStorage.getItem("scree-nocount") === "1") return;
    } catch {
      // storage blocked: count as usual
    }
    const url = new URL(window.location.href);
    const payload = JSON.stringify({
      p: url.pathname,
      a: url.searchParams.has("address") ? 1 : 0,
      r: document.referrer || "",
      m: window.matchMedia?.("(pointer: coarse)").matches ? 1 : 0,
    });
    try {
      if (navigator.sendBeacon?.("/api/visit", payload)) return;
    } catch {
      // fall through to fetch
    }
    void fetch("/api/visit", { method: "POST", body: payload, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {});
  }, []);
  return null;
}
