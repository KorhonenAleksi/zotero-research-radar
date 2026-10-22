// Settings pane logic. Filled in at milestone step 6 (journals, rules, authors).
export async function registerPrefsScripts(_window: Window) {
  addon.data.prefs = { window: _window };
}
