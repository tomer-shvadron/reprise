import type { Page } from '@playwright/test';

/** The stored value of a setting, or undefined until its row is written. */
export const storedSetting = (page: Page, key: string) =>
  page.evaluate(
    (name) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open('reprise');
        open.onerror = () => {
          resolve(undefined);
        };
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('settings')) {
            db.close();
            resolve(undefined);
            return;
          }
          const get = db.transaction('settings').objectStore('settings').get(name);
          get.onsuccess = () => {
            db.close();
            resolve((get.result as { value?: unknown } | undefined)?.value);
          };
          get.onerror = () => {
            db.close();
            resolve(undefined);
          };
        };
      }),
    key,
  );
