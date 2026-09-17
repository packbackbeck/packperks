import { createContext, useContext } from 'react';

/* The context object and its hook live apart from AccessProvider.jsx so that
 * file exports only a component (React Fast Refresh). */
export const AccessCtx = createContext(null);

export function useAccess() {
  const ctx = useContext(AccessCtx);
  if (!ctx) throw new Error('useAccess must be used inside <AccessProvider>');
  return ctx;
}
