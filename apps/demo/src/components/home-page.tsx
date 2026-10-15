import type { TilingLayout } from '@maelstrom-co/protocol';
import { DEFAULT_LAYOUT, NARROW_LAYOUT } from '../lib/default-layout';
import { m } from '../lib/maelstrom';
import { DemoWorkspace } from './demo-workspace';
import { FIRST_RUN_EXAMPLES } from './first-run-hint';
import { KeylessDemo } from './keyless-demo';
import { VesselOptionSync } from './vessel-option-sync';

export function HomePage() {
  return (
    <DemoWorkspace
      maelstrom={m}
      initialLayout={homeInitialLayout}
      OptionSync={VesselOptionSync}
      examples={FIRST_RUN_EXAMPLES}
      KeylessFallback={KeylessDemo}
    />
  );
}

function homeInitialLayout(hostWidth: number): TilingLayout {
  return hostWidth <= 640 ? NARROW_LAYOUT : DEFAULT_LAYOUT;
}
