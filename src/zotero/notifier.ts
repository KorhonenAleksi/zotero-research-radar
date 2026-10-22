import type { Store } from "../core/store";
import { radarCollectionIds } from "./library";

/**
 * Watches what the user does with Radar items:
 * - added to any non-Radar collection → "kept"
 * - moved to the Trash or deleted → "dismissed" (negative feedback, used later)
 * Only items the plugin created and that are still "active" are affected, so
 * the plugin's own cleanup (which marks items first) is never counted as a dismissal.
 */
export function registerNotifier(store: Store): string {
  return Zotero.Notifier.registerObserver(
    {
      notify: async (
        event: string,
        type: string,
        ids: Array<string | number>,
      ) => {
        try {
          if (type === "collection-item" && event === "add") {
            const radar = radarCollectionIds();
            for (const pair of ids) {
              const [collectionID, itemID] = String(pair)
                .split("-")
                .map(Number);
              if (radar.has(collectionID)) continue;
              const link = await store.linkForZoteroItem(itemID);
              if (link?.status === "active")
                await store.setLinkStatus(link.key, "kept");
            }
          } else if (
            type === "item" &&
            (event === "trash" || event === "delete")
          ) {
            for (const id of ids) {
              const link = await store.linkForZoteroItem(Number(id));
              if (link?.status === "active")
                await store.setLinkStatus(link.key, "dismissed");
            }
          }
        } catch (e) {
          Zotero.logError(e as Error);
        }
      },
    },
    ["collection-item", "item"],
    "researchradar",
  );
}

export function unregisterNotifier(id: string | undefined): void {
  if (id) Zotero.Notifier.unregisterObserver(id);
}
