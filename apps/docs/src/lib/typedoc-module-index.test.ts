import { expect, test } from 'bun:test';
import {
  Application,
  DeclarationReflection,
  FileRegistry,
  ProjectReflection,
  ReflectionKind,
} from 'typedoc';
import { ModuleIndexRouter } from './typedoc-module-index';

test('module links target publishable indexes without moving package or symbol URLs', async () => {
  const app = await Application.bootstrapWithPlugins({
    plugin: ['typedoc-plugin-markdown'],
    readme: 'none',
  });
  const project = new ProjectReflection('protocol', new FileRegistry());
  const module = new DeclarationReflection(
    'packages/realtime-protocol/src/openai-live',
    ReflectionKind.Module,
    project,
  );
  const symbol = new DeclarationReflection(
    'LiveSessionConfig',
    ReflectionKind.Interface,
    module,
  );
  project.children = [
    module,
    new DeclarationReflection('other', ReflectionKind.Module, project),
  ];
  project.childrenIncludingDocuments = project.children;
  module.children = [symbol];
  module.childrenIncludingDocuments = module.children;
  const router = new ModuleIndexRouter(app);
  const pages = router.buildPages(project);
  expect(router.getFullUrl(project)).toBe('README.md');
  expect(router.getFullUrl(module)).toBe(
    'packages/realtime-protocol/src/openai-live/index.md',
  );
  expect(
    pages.some(
      (page) => page.model === module && page.url === router.getFullUrl(module),
    ),
  ).toBe(true);
  expect(router.getFullUrl(symbol)).toBe(
    'packages/realtime-protocol/src/openai-live/interfaces/LiveSessionConfig.md',
  );
});
