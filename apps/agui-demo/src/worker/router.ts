const endpoints = new Set([
  '/api/workspace/bootstrap',
  '/api/workspace/reset',
  '/api/workspace/records',
  '/api/workspace/operations',
  '/api/workspace/exchange',
  '/api/workspace/stop',
  '/api/workspace/voice',
  '/api/goal',
]);
const routePattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function rejected(status: number, code: string) {
  return Response.json(
    { error: { code } },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

export async function routeWorkspace(
  request: Request,
  env: Pick<Env, 'WORKSPACES'>,
) {
  const url = new URL(request.url);
  if (!endpoints.has(url.pathname)) return rejected(404, 'NOT_FOUND');
  if (request.headers.get('origin') !== url.origin)
    return rejected(403, 'ORIGIN_REJECTED');
  if (request.method !== 'POST') return rejected(405, 'METHOD_REJECTED');
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    return rejected(415, 'JSON_REQUIRED');
  const secure = url.protocol === 'https:';
  if (!secure && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    return rejected(403, 'ORIGIN_REJECTED');
  const name = secure ? '__Host-agui_route' : 'agui_local_route';
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (cookie && !routePattern.test(cookie))
    return rejected(401, 'INVALID_ROUTE');
  if (!cookie && url.pathname !== '/api/workspace/bootstrap')
    return rejected(401, 'UNAUTHORIZED');
  const route = cookie || crypto.randomUUID();
  try {
    const response = await env.WORKSPACES.getByName(
      `${url.origin}:${route}`,
    ).fetch(request);
    const result = new Response(response.body, response);
    if (result.ok) {
      const reset = url.pathname === '/api/workspace/reset';
      result.headers.append(
        'Set-Cookie',
        `${name}=${reset ? '' : route}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${reset ? 0 : 604800}${secure ? '; Secure' : ''}`,
      );
    }
    return result;
  } catch {
    return rejected(503, 'WORKSPACE_UNAVAILABLE');
  }
}
