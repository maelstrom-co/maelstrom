import { resolve } from 'node:path';
import { createSkillsBundle } from '../../../../tools/skills/bundle';

export const prerender = true;

export async function GET(): Promise<Response> {
  const projectRoot = process.cwd();
  const archive = await createSkillsBundle(
    resolve(projectRoot, 'skills'),
    resolve(projectRoot, '../../docs'),
  );
  return new Response(Buffer.from(archive), {
    headers: {
      'Content-Disposition':
        'attachment; filename="maelstrom-agent-skills.zip"',
      'Content-Type': 'application/zip',
    },
  });
}
