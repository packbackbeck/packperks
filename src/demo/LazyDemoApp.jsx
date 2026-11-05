import { Suspense, lazy } from 'react';

/* The /demo pages load on their own, so the customer app never ships them. */
const DemoApp = lazy(() => import('./DemoApp.jsx'));

export default function LazyDemoApp() {
  return (
    <Suspense fallback={null}>
      <DemoApp />
    </Suspense>
  );
}
