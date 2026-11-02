import { describe, expect, it } from 'vitest';
import { Route as RootRoute } from './__root';
import { Route } from './index';

describe('index route head', () => {
  it('titles the page as Dayline, powered by Maelstrom', async () => {
    const head = await Route.options.head?.({} as never);

    expect(head?.meta).toContainEqual({
      title: 'Dayline, powered by Maelstrom',
    });
    expect(head?.meta).toContainEqual({
      name: 'description',
      content: expect.stringContaining('Dayline'),
    });
  }, 15_000);

  it('leaves the shared root title for other routes', async () => {
    const head = await RootRoute.options.head?.({} as never);

    expect(head?.meta).toContainEqual({ title: 'Maelstrom Demo' });
  });
});
