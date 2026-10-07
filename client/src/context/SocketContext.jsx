import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  useEffect(() => {
    if (!token || !user?.workspace) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setConnected(false);
      }
      return;
    }

    const newSocket = io({
      auth: { token },
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      setConnected(true);
      setIsReconnecting(false);
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
      setIsReconnecting(true);
    });

    newSocket.on('connect_error', () => {
      setConnected(false);
      setIsReconnecting(true);
    });

    newSocket.on('app:error', (data) => {
      addToast(data.message || 'An application error occurred', 'error');
    });

    newSocket.on('ai:error', (data) => {
      addToast(data.message || 'AI assistant error', 'error');
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [token, user?.workspace]);

  return (
    <SocketContext.Provider value={{ socket, connected, isReconnecting, toasts, addToast }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
