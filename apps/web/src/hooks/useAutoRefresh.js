import { useEffect, useRef } from "react";

// Calls `refresh` every `ms` while the page is visible, and right away when
// the user comes back to the tab, so lists (live sessions, new recordings)
// update without a reload. A hidden tab doesn't poll.
export function useAutoRefresh(refresh, ms = 10000) {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    let timer = null;
    const run = () => { latest.current(); };
    const start = () => {
      if (timer === null) timer = setInterval(run, ms);
    };
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        run();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", run);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", run);
    };
  }, [ms]);
}
