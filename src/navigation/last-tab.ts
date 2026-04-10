/**
 * Holds the last-active tab name read from the DB during app initialisation.
 * Written once before the tab navigator renders so there is no visual flash.
 */
export let restoredTab: string | undefined = undefined;

export function initRestoredTab(tab: string | null): void {
  // Only override the default when we have a non-index tab to restore.
  if (tab && tab !== 'index') {
    restoredTab = tab;
  }
}
