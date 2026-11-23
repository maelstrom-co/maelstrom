import pinTemplateSource from '../../../docs/tools/skills/published-examples/package.json.template?raw';

/**
 * The exact `@maelstrom-co/react` version from the shared published version
 * pin, so the page never shows a version that is not on npm.
 */
export const MAELSTROM_PACKAGE_VERSION = readPinnedReactVersion();

function readPinnedReactVersion(): string {
  const pin = JSON.parse(pinTemplateSource) as {
    dependencies?: Record<string, string>;
  };
  const version = pin.dependencies?.['@maelstrom-co/react'];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `The published version pin needs an exact @maelstrom-co/react version, found ${JSON.stringify(version)}`,
    );
  }
  return version;
}
