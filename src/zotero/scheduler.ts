import { getPref } from "../utils/prefs";

const CHECK_EVERY_MS = 30 * 60 * 1000;
const STARTUP_DELAY_MS = 2 * 60 * 1000;

let timer: any = null;
let startupTimer: any = null;

/** Is an automatic fetch due? Only when auto-fetch is on and the interval has passed. */
function due(): boolean {
  if (getPref("autoFetch") !== true) return false;
  const last = Date.parse(String(getPref("lastRun") || ""));
  const hours = Number(getPref("fetchIntervalHours")) || 12;
  return !Number.isFinite(last) || Date.now() - last >= hours * 60 * 60 * 1000;
}

function makeTimer(cb: () => void, ms: number, repeating: boolean) {
  // nsITimer works in the plugin sandbox, where window timers may not exist
  const t = (Components.classes as any)["@mozilla.org/timer;1"].createInstance(
    Components.interfaces.nsITimer,
  );
  t.initWithCallback(
    { notify: cb },
    ms,
    repeating
      ? Components.interfaces.nsITimer.TYPE_REPEATING_SLACK
      : Components.interfaces.nsITimer.TYPE_ONE_SHOT,
  );
  return t;
}

/** Checks two minutes after startup, then every 30 minutes; fetches only when due. */
export function startScheduler(fetch: () => void): void {
  stopScheduler();
  const tick = () => {
    if (due()) fetch();
  };
  startupTimer = makeTimer(tick, STARTUP_DELAY_MS, false);
  timer = makeTimer(tick, CHECK_EVERY_MS, true);
}

export function stopScheduler(): void {
  timer?.cancel();
  startupTimer?.cancel();
  timer = startupTimer = null;
}
