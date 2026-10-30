import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { EditorShell } from './shell/EditorShell';

/** Last-resort screen: an unexpected error shows a message and a reload button, never a blank page. */
function RootError({ error }: ErrorComponentProps) {
  return (
    <div role="alert" className="flex h-full items-center justify-center bg-bg p-6 text-ink">
      <div className="max-w-md rounded-xl border border-line bg-panel p-5 shadow-panel">
        <h1 className="m-0 mb-2 text-base font-[650]">Something went wrong</h1>
        <p className="m-0 mb-1 text-[13px] text-muted">
          The editor hit an unexpected error. Your design is saved on this device; reloading usually fixes it.
        </p>
        <pre className="mb-4 max-h-32 overflow-auto rounded-md bg-seg p-2 text-[11.5px] text-muted">
          {error instanceof Error ? error.message : String(error)}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-9 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink"
        >
          Reload the editor
        </button>
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({ component: Outlet, errorComponent: RootError });

const editorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: EditorShell });
const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ui',
  component: lazyRouteComponent(() => import('./gallery/Gallery'), 'Gallery'),
});

export const router = createRouter({ routeTree: rootRoute.addChildren([editorRoute, galleryRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
