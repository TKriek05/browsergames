// Safe wrappers around localStorage / sessionStorage. Storage can throw in
// private mode or when disabled, so every access is guarded.
const PREFIX = 'arcade:';

function wrap(getStore) {
  return {
    get(key, fallback = null) {
      try {
        const raw = getStore().getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        getStore().setItem(PREFIX + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        getStore().removeItem(PREFIX + key);
      } catch {
        /* ignore */
      }
    },
  };
}

// Persistent: nickname, mute, highscores, settings.
export const local = wrap(() => window.localStorage);
// Per tab: the room session token (so two tabs are two different players).
export const session = wrap(() => window.sessionStorage);
