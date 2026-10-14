import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  tone?: 'error';
}
type Push = (text: string, opts?: { action?: ToastItem['action']; tone?: 'error'; ms?: number }) => void;

const Ctx = createContext<Push>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));
  const push = useCallback<Push>((text, opts = {}) => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-3), { id, text, action: opts.action, tone: opts.tone }]);
    setTimeout(() => dismiss(id), opts.ms ?? (opts.action ? 8000 : opts.tone === 'error' ? 6000 : 3000));
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
