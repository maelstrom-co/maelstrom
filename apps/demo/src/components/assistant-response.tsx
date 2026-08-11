import { GripHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

interface AssistantResponseProps {
  readonly isProcessing: boolean;
  readonly message: string | undefined;
  readonly voiceActive: boolean;
}

interface Position {
  readonly x: number;
  readonly y: number;
}

interface DragStart {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly position: Position;
  readonly rect: DOMRect;
}

const VIEWPORT_GUTTER = 8;
const KEYBOARD_STEP = 12;
const INITIAL_POSITION: Position = { x: 0, y: 0 };

function clampToViewport(
  position: Position,
  rect: DOMRect,
  rectPosition: Position,
): Position {
  const baseLeft = rect.left - rectPosition.x;
  const baseTop = rect.top - rectPosition.y;
  return {
    x: Math.min(
      window.innerWidth - VIEWPORT_GUTTER - rect.width - baseLeft,
      Math.max(VIEWPORT_GUTTER - baseLeft, position.x),
    ),
    y: Math.min(
      window.innerHeight - VIEWPORT_GUTTER - rect.height - baseTop,
      Math.max(VIEWPORT_GUTTER - baseTop, position.y),
    ),
  };
}

export function AssistantResponse({
  isProcessing,
  message,
  voiceActive,
}: AssistantResponseProps) {
  const [position, setPosition] = useState(INITIAL_POSITION);
  const [dragging, setDragging] = useState(false);
  const positionerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<DragStart>(null);
  const hasRenderedRef = useRef(false);
  const moveInstructionsId = useId();

  useEffect(() => {
    const resetPosition = () => {
      dragStartRef.current = null;
      setDragging(false);
      setPosition(INITIAL_POSITION);
    };
    window.addEventListener('resize', resetPosition);
    return () => window.removeEventListener('resize', resetPosition);
  }, []);

  useLayoutEffect(() => {
    if (!hasRenderedRef.current) {
      hasRenderedRef.current = true;
      return;
    }
    dragStartRef.current = null;
    setDragging(false);
    if (voiceActive || (!isProcessing && !message) || !positionerRef.current) {
      return;
    }

    const rect = positionerRef.current.getBoundingClientRect();
    setPosition((current) => clampToViewport(current, rect, current));
  }, [isProcessing, message, voiceActive]);

  if (voiceActive || (!isProcessing && !message)) return null;

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !positionerRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      position,
      rect: positionerRef.current.getBoundingClientRect(),
    };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setPosition(
      clampToViewport(
        {
          x: start.position.x + event.clientX - start.clientX,
          y: start.position.y + event.clientY - start.clientY,
        },
        start.rect,
        start.position,
      ),
    );
  };

  const finishDragging = () => {
    dragStartRef.current = null;
    setDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Home') {
      event.preventDefault();
      setPosition(INITIAL_POSITION);
      return;
    }

    const step = event.shiftKey ? KEYBOARD_STEP * 3 : KEYBOARD_STEP;
    const delta = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }[event.key];
    if (!delta || !positionerRef.current) return;

    event.preventDefault();
    setPosition((current) =>
      clampToViewport(
        { x: current.x + delta.x, y: current.y + delta.y },
        positionerRef.current?.getBoundingClientRect() ?? new DOMRect(),
        current,
      ),
    );
  };

  return (
    <div className="assistant-response-layer">
      <div
        ref={positionerRef}
        className="assistant-response-positioner"
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        }}
      >
        <section
          className="assistant-response"
          data-state={isProcessing ? 'thinking' : 'complete'}
          data-dragging={dragging || undefined}
          aria-label="Maelstrom response"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus this scrollable region.
          tabIndex={0}
        >
          <div className="assistant-response-mark" aria-hidden="true">
            <Sparkles size={15} strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1" role="status" aria-atomic="true">
            <p className="assistant-response-label">Maelstrom</p>
            {isProcessing ? (
              <p className="assistant-response-thinking">
                <span className="sr-only">Maelstrom is thinking. </span>
                <span aria-hidden="true">Mapping that to your workspace</span>
                <span className="assistant-response-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </p>
            ) : (
              <p className="assistant-response-message">{message}</p>
            )}
          </div>
          <button
            type="button"
            className="assistant-response-drag-handle"
            aria-label="Move Maelstrom response"
            aria-describedby={moveInstructionsId}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
            title="Drag to move · Arrow keys to nudge · Home to reset"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDragging}
            onPointerCancel={finishDragging}
            onLostPointerCapture={finishDragging}
            onKeyDown={handleKeyDown}
          >
            <GripHorizontal size={16} strokeWidth={1.8} />
          </button>
          <span id={moveInstructionsId} className="sr-only">
            Use the arrow keys to move the response. Hold Shift for larger
            steps. Press Home to reset its position.
          </span>
        </section>
      </div>
    </div>
  );
}
