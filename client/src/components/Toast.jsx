import React from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export function ToastContainer() {
  const { toasts } = useSocket() || { toasts: [] };

  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container" id="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
