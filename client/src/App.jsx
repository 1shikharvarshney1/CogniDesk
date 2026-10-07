import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { SocketProvider, useSocket } from './context/SocketContext.jsx';
import { Navbar } from './components/Navbar.jsx';
import { ToastContainer } from './components/Toast.jsx';
import { Login } from './pages/Login.jsx';
import { Onboarding } from './pages/Onboarding.jsx';
import { Inbox } from './pages/Inbox.jsx';
import { KnowledgeBase } from './pages/KnowledgeBase.jsx';
import { Settings } from './pages/Settings.jsx';
import { CustomerChat } from './pages/CustomerChat.jsx';

function ProtectedLayout({ children }) {
  const { user, loading } = useAuth();
  const { isReconnecting } = useSocket() || {};

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-dim)' }}>
        Loading SupportDesk...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.workspace) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <div className="app-container">
      {isReconnecting && (
        <div className="reconnect-banner">
          Reconnecting to real-time server...
        </div>
      )}
      <Navbar />
      <ToastContainer />
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {children}
      </main>
    </div>
  );
}

function OnboardingRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-dim)' }}>
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.workspace) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="app-container">
      <ToastContainer />
      <Onboarding />
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Customer Chat */}
            <Route path="/chat/:publicKey" element={<CustomerChat />} />

            {/* Agent Auth */}
            <Route path="/login" element={<Login />} />
            <Route path="/onboarding" element={<OnboardingRoute />} />

            {/* Protected Agent Routes */}
            <Route
              path="/"
              element={
                <ProtectedLayout>
                  <Inbox />
                </ProtectedLayout>
              }
            />
            <Route
              path="/kb"
              element={
                <ProtectedLayout>
                  <KnowledgeBase />
                </ProtectedLayout>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedLayout>
                  <Settings />
                </ProtectedLayout>
              }
            />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  );
}
