import {
  createDevtools,
  mountDevtools,
} from '@maelstrom-co/devtools/production';

const advancing =
  new URLSearchParams(location.search).get('scenario') === 'advancing';
const acceptedCounts = [100, 107, 109];
mountDevtools(
  createDevtools({
    initialIsOpen: true,
    telemetry: {
      getSnapshot: () => {
        const accepted = advancing ? (acceptedCounts.shift() ?? 109) : 100;
        return {
          state: 'active',
          accepted,
          delivered: accepted - 49,
          queued: 41,
          exporting: 8,
          dropped: {
            invalid: 0,
            overflow: 0,
            exportError: 0,
            timeout: 0,
            disabled: 0,
            disposed: 0,
          },
        };
      },
    },
  }),
);
