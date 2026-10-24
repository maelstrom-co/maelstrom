import { resolve } from 'node:path';
import { createReactStarter } from '../../../tools/skills/starter-bundle';

export const prerender = true;

export async function GET(): Promise<Response> {
  const archive = await createReactStarter(
    resolve(process.cwd(), 'starters/react'),
    resolve(process.cwd(), '../../LICENSE'),
  );
  return new Response(Buffer.from(archive), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition':
        'attachment; filename="maelstrom-react-starter.zip"',
    },
  });
}
