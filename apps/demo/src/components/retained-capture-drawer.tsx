import { X } from 'lucide-react';
import { useRef, useSyncExternalStore } from 'react';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { CapturePanel } from './diagnostic-capture-panel';
import './voice-debug.css';

export function RetainedCaptureDrawer() {
  const state = useSyncExternalStore(
    diagnosticCapture.subscribe,
    diagnosticCapture.getSnapshot,
    diagnosticCapture.getSnapshot,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    dialog.current?.close();
    trigger.current?.focus();
  };
  if (state.count === 0) return null;
  return (
    <>
      <aside
        className="fixed right-4 bottom-24 z-50 flex gap-2 rounded-xl border border-ink-3 bg-bg-1 p-2"
        aria-label="Retained diagnostic capture"
      >
        <button
          ref={trigger}
          type="button"
          className="debug-button"
          aria-haspopup="dialog"
          onClick={() => dialog.current?.showModal()}
        >
          Debug · Retained capture
        </button>
        {state.active && (
          <button
            type="button"
            className="debug-button debug-button-record"
            onClick={() => diagnosticCapture.stop()}
          >
            Stop capture
          </button>
        )}
      </aside>
      <dialog
        ref={dialog}
        className="debug-drawer"
        aria-labelledby="retained-capture-title"
        onClose={() => trigger.current?.focus()}
      >
        <header className="debug-header">
          <div className="debug-title">
            <div>
              <span className="debug-eyebrow">Stored in this tab</span>
              <h2 id="retained-capture-title">Retained capture</h2>
            </div>
          </div>
          <button
            type="button"
            className="debug-button debug-close"
            aria-label="Close diagnostics"
            onClick={close}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="debug-body">
          <CapturePanel />
        </div>
      </dialog>
    </>
  );
}
