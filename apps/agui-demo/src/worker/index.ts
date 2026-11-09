import { routeWorkspace } from './router';

export { WorkspaceDO } from './workspace-do';

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/api/'))
      return routeWorkspace(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
