/**
 * Set when Zotero is quitting or the plugin is being disabled: long-running
 * work (fetch, AI judging) stops at its next safe point.
 */
let stopRequested = false;

export function requestStop(): void {
  stopRequested = true;
}

export const shouldStop = (): boolean => stopRequested;
