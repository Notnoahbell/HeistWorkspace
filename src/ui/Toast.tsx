// A brief confirmation at the bottom of the canvas, e.g. after moving things
// into another board ("Moved 2 items to Moodboard · Open"). A busy one (e.g.
// fetching a Pinterest pin) stays until it's replaced, its icon hopping.

import { useEffect } from 'react';
import { Pin } from 'lucide-react';
import { useUi } from '../board/ui';
import { enterBoard } from '../board/actions';

const SHOW_MS = 3500;

export function Toast() {
  const toast = useUi((s) => s.toast);

  useEffect(() => {
    if (!toast || toast.busy) return;
    const t = setTimeout(() => {
      if (useUi.getState().toast === toast) useUi.getState().set({ toast: null });
    }, SHOW_MS);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.at} data-busy={toast.busy || undefined}>
      {toast.icon === 'pin' && (
        <span className="toast-icon" data-busy={toast.busy || undefined} aria-hidden="true">
          <span className="toast-pin"><Pin size={17} strokeWidth={2.2} /></span>
        </span>
      )}
      <span>{toast.text}</span>
      {toast.boardId && (
        <button
          onClick={() => {
            useUi.getState().set({ toast: null });
            enterBoard(toast.boardId!);
          }}
        >
          Open
        </button>
      )}
    </div>
  );
}
