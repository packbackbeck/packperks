import { createContext, useContext } from 'react';

/* Split from ThemeContext.jsx so that file only exports components, which
 * is what fast refresh wants (the same split as accessCtx.js). */
export const ThemeCtx = createContext({
  theme: 'light',
  auto: false,
  setTheme: () => {},
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeCtx);
}
