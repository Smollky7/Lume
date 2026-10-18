import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ToastKind } from '../lib/types';

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

type Notify = (kind: ToastKind, text: string) => void;
const Ctx = createContext<Notify>(() => undefined);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const notify = useCallback<Notify>((kind, text) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span className="toast-dot" />
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
