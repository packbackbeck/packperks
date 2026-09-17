import { Suspense, lazy } from 'react';

/* PackPerks Staff loads on its own, so the customer app never ships it. */
const StaffApp = lazy(() => import('./StaffApp.jsx'));

export default function LazyStaffApp() {
  return (
    <Suspense fallback={null}>
      <StaffApp />
    </Suspense>
  );
}
