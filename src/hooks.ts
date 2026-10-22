import { version } from "../package.json";
import { initLocale } from "./utils/locale";
import { startApp, stopApp } from "./zotero/app";
import { initPrefsPane } from "./zotero/prefsPane";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: addon.data.config.addonName,
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
    // ?v= makes Zotero load this version's stylesheet, not a cached older copy
    stylesheets: [
      `chrome://${addon.data.config.addonRef}/content/preferences.css?v=${version}`,
    ],
  });

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  await startApp();

  ztoolkit.log(`${addon.data.config.addonName} started`);

  // Lets the scaffold test runner detect that the plugin has loaded
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

async function onShutdown(): Promise<void> {
  await stopApp();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      initPrefsPane(data.window);
      break;
    default:
      return;
  }
}

// Hooks only dispatch; real work lives in src/zotero/ and src/core/.
export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};
