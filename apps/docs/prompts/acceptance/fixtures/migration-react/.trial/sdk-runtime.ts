import { strict as assert } from 'node:assert';
import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';

assert.equal(typeof createMaelstrom, 'function');
assert.equal(typeof defineVessel, 'function');
assert.equal(typeof vessel, 'function');
console.log(
  'SDK runtime exports resolved; no Vessel or connector was created.',
);
