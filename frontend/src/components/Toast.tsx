import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration: number = 4000) => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => onRemove(toast.id), 200);
    }, toast.duration || 4000);

    return () => clearTimeout(timer);
  }, [toast, onRemove]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 200);
  };

  const prefixByType: Record<ToastType, { text: string; color: string }> = {
    success: { text: '[OK]', color: 'text-term-green' },
    error: { text: '[ERR]', color: 'text-term-red' },
    warning: { text: '[WARN]', color: 'text-term-yellow' },
    info: { text: '[INFO]', color: 'text-term-blue' },
  };

  const borderByType: Record<ToastType, string> = {
    success: 'border-term-green',
    error: 'border-term-red',
    warning: 'border-term-yellow',
    info: 'border-term-border',
  };

  const prefix = prefixByType[toast.type];

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 border bg-term-surface text-xs pointer-events-auto min-w-[280px] max-w-[400px] transition-all duration-200 ${
        borderByType[toast.type]
      } ${isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}`}
    >
      <span className={`flex-shrink-0 ${prefix.color}`}>{prefix.text}</span>
      <span className="text-term-fg flex-1">{toast.message}</span>
      <button
        onClick={handleClose}
        className="flex-shrink-0 text-term-fg-dim hover:text-term-fg-bright transition-colors"
      >
        [x]
      </button>
    </div>
  );
}

export default ToastProvider;
