import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

function NotFoundComponent() {
  return (
    <div className="flex items-center justify-center h-screen bg-bg text-ink-2">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-ink mb-4">404</h1>
        <p className="text-ink-2 mb-6">Page not found</p>
        <a href="/" className="text-brand hover:text-brand-2 underline">
          Go back home
        </a>
      </div>
    </div>
  );
}

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultNotFoundComponent: NotFoundComponent,
  });

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
