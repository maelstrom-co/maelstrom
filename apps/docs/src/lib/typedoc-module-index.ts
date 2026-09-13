import { posix } from 'node:path';
import { type Application, type Reflection, ReflectionKind } from 'typedoc';
import { MemberRouter } from 'typedoc-plugin-markdown';

export class ModuleIndexRouter extends MemberRouter {
  override getIdealBaseName(reflection: Reflection): string {
    const name = super.getIdealBaseName(reflection);
    // Starlight removes nested README pages when no authored readme is configured.
    return reflection.kind === ReflectionKind.Module
      ? posix.join(posix.dirname(name), 'index')
      : name;
  }
}

export function load(app: Application): void {
  app.renderer.defineRouter('module-index', ModuleIndexRouter);
}
