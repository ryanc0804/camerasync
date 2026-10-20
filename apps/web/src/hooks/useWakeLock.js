import { useEffect } from "react";

// Keeps the screen on while `active`, so a computer left on a live session
// doesn't dim, lock or sleep between takes and start the next one late. The
// browser drops the lock whenever the tab is hidden, so it is taken again
// each time the tab comes back. Browsers without the Screen Wake Lock API
// (Safari before 16.4, Firefox before 126) just keep their usual sleep.
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return undefined;
    let lock = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (lock && !lock.released) return;
      try {
        lock = await navigator.wakeLock.request("screen");
        if (cancelled) lock.release().catch(() => {});
      } catch {
        // Refused (low battery, power saver, no user gesture yet); try again
        // on the next visibility change.
        lock = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    // Safari only grants a lock after the page has been interacted with.
    document.addEventListener("pointerdown", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerdown", acquire);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
