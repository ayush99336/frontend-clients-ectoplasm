import React, { createContext, useContext, useState, useCallback } from 'react';

type ToastType = 'success' | 'error' | 'pending' | 'info';

interface Toast {
    id: string;
    type: ToastType;
    message: string;
    txHash?: string;
}

interface ToastContextType {
    toasts: Toast[];
    showToast: (type: ToastType, message: string, txHash?: string) => void;
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((type: ToastType, message: string, txHash?: string) => {
        const id = Date.now().toString();
        const newToast: Toast = { id, type, message, txHash };
        
        setToasts(prev => [...prev, newToast]);

        // Auto-remove after 5 seconds (except pending)
        if (type !== 'pending') {
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, 5000);
        }
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
            {children}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within ToastProvider');
    }
    return context;
};

const ToastContainer: React.FC<{ toasts: Toast[]; onRemove: (id: string) => void }> = ({ toasts, onRemove }) => {
    return (
        <div style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            maxWidth: '400px'
        }}>
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
            ))}
        </div>
    );
};

const ToastItem: React.FC<{ toast: Toast; onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
    const getIcon = () => {
        switch (toast.type) {
            case 'success': return '✅';
            case 'error': return '❌';
            case 'pending': return '⏳';
            case 'info': return 'ℹ️';
        }
    };

    const getColor = () => {
        switch (toast.type) {
            case 'success': return '#4ade80';
            case 'error': return '#ef4444';
            case 'pending': return '#fbbf24';
            case 'info': return '#60a5fa';
        }
    };

    return (
        <div style={{
            background: 'rgba(0, 0, 0, 0.9)',
            border: `2px solid ${getColor()}`,
            borderRadius: '8px',
            padding: '16px',
            color: 'white',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
            animation: 'slideIn 0.3s ease-out',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px'
        }}>
            <span style={{ fontSize: '20px' }}>{getIcon()}</span>
            <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                    {toast.type.charAt(0).toUpperCase() + toast.type.slice(1)}
                </div>
                <div style={{ fontSize: '14px', color: '#ddd' }}>
                    {toast.message}
                </div>
                {toast.txHash && (
                    <a
                        href={`https://testnet.cspr.live/deploy/${toast.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            color: getColor(),
                            fontSize: '12px',
                            marginTop: '8px',
                            display: 'block',
                            textDecoration: 'underline'
                        }}
                    >
                        View on Explorer →
                    </a>
                )}
            </div>
            {toast.type !== 'pending' && (
                <button
                    onClick={() => onRemove(toast.id)}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#999',
                        cursor: 'pointer',
                        fontSize: '18px',
                        padding: '0',
                        lineHeight: '1'
                    }}
                >
                    ×
                </button>
            )}
        </div>
    );
};
