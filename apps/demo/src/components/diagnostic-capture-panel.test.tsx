// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { VoiceDiagnostics } from '../lib/voice-diagnostics';
import { DiagnosticCapturePanel } from './diagnostic-capture-panel';
import { DiagnosticEvents } from './diagnostic-events';
import { RetainedCaptureDrawer } from './retained-capture-drawer';

const fixture = vi.hoisted(() => ({
  provider: 'live',
  connection: 'connected',
}));
vi.mock('../lib/maelstrom', () => ({
  m: {
    useVoice: () => ({
      provider: fixture.provider,
      owner: {
        memory: { sessionId: 'session-test' },
        providerInstanceId: 'provider-test',
        session: {
          observations: {
            getSnapshot: () => ({
              generation: 1,
              connection: fixture.connection,
              media: {},
              applicationWork: {},
              fragments: [],
            }),
          },
        },
      },
    }),
    useVoiceObservations: () => ({
      snapshot: { connection: fixture.connection },
    }),
  },
}));

afterEach(() => {
  cleanup();
  diagnosticCapture.clear();
  fixture.connection = 'connected';
  fixture.provider = 'live';
});

it('keeps notes and input identity after the voice subtree remounts', () => {
  const first = render(<DiagnosticCapturePanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start capture' }));
  fireEvent.change(screen.getByLabelText(/What happened/), {
    target: { value: 'Keep this evidence' },
  });
  first.unmount();
  fixture.connection = 'disconnected';
  fixture.provider = 'realtime';
  render(<DiagnosticCapturePanel />);
  expect(screen.getByText('GPT-Live voice')).toBeTruthy();
  expect(
    (screen.getByLabelText(/What happened/) as HTMLTextAreaElement).value,
  ).toBe('Keep this evidence');
  fireEvent.click(screen.getByRole('button', { name: 'Stop capture' }));
  expect(JSON.parse(diagnosticCapture.export()).outcome).toBe(
    'Keep this evidence',
  );
});

it('offers access to retained recordings without a voice provider or API key', () => {
  diagnosticCapture.start('live', 'session', 'provider');
  render(<RetainedCaptureDrawer />);
  expect(
    screen.getByRole('button', { name: 'Debug · Retained capture' }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Stop capture' }));
  expect(diagnosticCapture.getSnapshot().active).toBe(false);
  expect(
    screen.getByRole('button', { name: 'Debug · Retained capture' }),
  ).toBeTruthy();
});

it('does not turn missing application confirmation into a failed mutation', () => {
  render(
    <DiagnosticEvents
      events={[{ kind: 'tool_result', ok: false }]}
      label="Activity"
    />,
  );
  expect(screen.getByText('Not confirmed')).toBeTruthy();
  expect(screen.queryByText('Failed')).toBeNull();
});

it('keeps an inspected event expanded as the activity buffer rolls over equal timestamps', () => {
  const diagnostics = new VoiceDiagnostics();
  for (let i = 0; i < 99; i++)
    diagnostics.record({ kind: 'voice_state', at: 1, state: 'connected' });
  diagnostics.record({ kind: 'voice_state', at: 1, state: 'speaking' });
  const { rerender } = render(
    <DiagnosticEvents events={diagnostics.getSnapshot()} label="Activity" />,
  );
  const inspected = screen.getByText('speaking').closest('details')!;
  inspected.open = true;
  diagnostics.record({ kind: 'engine_started', at: 1 });
  rerender(
    <DiagnosticEvents events={diagnostics.getSnapshot()} label="Activity" />,
  );
  expect(screen.getByText('speaking').closest('details')).toBe(inspected);
  expect(inspected.open).toBe(true);
});

it.each([
  'live',
  'realtime',
  'livekit',
])('records the connected %s provider without a manual mode selection', (provider) => {
  fixture.provider = provider;
  render(<DiagnosticCapturePanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start capture' }));
  expect(JSON.parse(diagnosticCapture.export('')).metadata.mode).toBe(provider);
  expect(
    screen
      .getByRole('button', { name: 'Clear capture' })
      .hasAttribute('disabled'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Stop capture' }));
  expect(
    screen
      .getByRole('button', { name: 'Start capture' })
      .hasAttribute('disabled'),
  ).toBe(true);
  expect(
    screen
      .getByRole('button', { name: 'Download trace' })
      .hasAttribute('disabled'),
  ).toBe(false);
});

it('uses typed input while disconnected and waits through connection transitions', () => {
  fixture.connection = 'connecting';
  const { rerender } = render(<DiagnosticCapturePanel />);
  expect(
    screen
      .getByRole('button', { name: 'Start capture' })
      .hasAttribute('disabled'),
  ).toBe(true);
  fixture.connection = 'disconnected';
  rerender(<DiagnosticCapturePanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start capture' }));
  expect(JSON.parse(diagnosticCapture.export('')).metadata.mode).toBe('typed');
});

it('keeps the captured provider label when the current provider changes and only clears on request', () => {
  const { rerender } = render(<DiagnosticCapturePanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start capture' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop capture' }));
  fixture.provider = 'realtime';
  rerender(<DiagnosticCapturePanel />);
  expect(screen.getByText('GPT-Live voice')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/What happened/), {
    target: { value: 'Observed delay' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Clear capture' }));
  expect(diagnosticCapture.getSnapshot().count).toBe(0);
  expect(screen.getByText('Realtime voice')).toBeTruthy();
});

it('finds older correlated events beyond the initial page without changing the trace', () => {
  const events = Array.from({ length: 30 }, (_, index) => ({
    kind: 'engine_completed',
    at: index,
    id: `request-${index}`,
  }));
  render(<DiagnosticEvents events={events} label="Captured events" />);
  expect(screen.getAllByRole('listitem')).toHaveLength(25);
  fireEvent.click(screen.getByRole('button', { name: 'Show 25 more' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(30);
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'request-0"' },
  });
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(events[0]?.id).toBe('request-0');
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'absent' },
  });
  expect(
    screen.getByText('No matching events. Try a different search.'),
  ).toBeTruthy();
});
