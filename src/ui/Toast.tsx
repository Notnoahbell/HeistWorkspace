// A brief confirmation at the bottom of the canvas, e.g. after moving things
// into another board ("Moved 2 items to Moodboard · Open").

import { useEffect } from 'react';
import { useUi } from '../board/ui';
import { enterBoard } from '../board/actions';

const SHOW_MS = 3500;

export function Toast() {
  const toast = useUi((s) => s.toast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      if (useUi.getState().toast === toast) useUi.getState().set({ toast: null });
    }, SHOW_MS);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.at}>
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
