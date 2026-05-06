import { useState, useEffect } from 'react';

const PREFIX = 'packperks_';

export default function usePersistedState(key, defaultValue) {
  const storageKey = PREFIX + key;

  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // localStorage full or unavailable — fail silently
    }
  }, [storageKey, value]);

  return [value, setValue];
}
