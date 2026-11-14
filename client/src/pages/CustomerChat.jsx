import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { api } from '../api/http.js';

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function CustomerChat() {
  const { publicKey } = useParams();

  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceError, setWorkspaceError] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);

  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const [hasStarted, setHasStarted] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [visitorId, setVisitorId] = useState('');
  const [conversationId, setConversationId] = useState('');

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [appError, setAppError] = useState('');

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Storage key scoped to this workspace publicKey
  const storageKey = `cognidesk_cust_${publicKey}`;

  // 1. Fetch public workspace info
  useEffect(() => {
    async function fetchWorkspace() {
      try {
        const data = await api.getPublicWorkspace(publicKey);
        setWorkspaceName(data.workspaceName);
      } catch (err) {
        setWorkspaceError(true);
      } finally {
        setLoadingWorkspace(false);
      }
    }
    fetchWorkspace();
  }, [publicKey]);

  // 2. Initialize customer socket and check stored session
  useEffect(() => {
    if (workspaceError || loadingWorkspace) return;

    const savedSession = sessionStorage.getItem(storageKey);
    let initialVisitorId = null;
    let initialName = '';
    let initialEmail = '';

    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        initialVisitorId = parsed.visitorId || null;
        initialName = parsed.name || '';
        initialEmail = parsed.email || '';
        setName(initialName);
        setEmail(initialEmail);
        setVisitorId(initialVisitorId);
      } catch {
        // Ignore invalid session
      }
    }

    const newSocket = io({
      auth: {
        publicKey,
        visitorId: initialVisitorId
      },
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      setConnected(true);
      setIsReconnecting(false);

      // Auto-resume if session existed with customer name
      if (initialVisitorId && initialName) {
        newSocket.emit('customer:start', {
          name: initialName,
          email: initialEmail,
          visitorId: initialVisitorId
        });
      }
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
      setIsReconnecting(true);
    });

    newSocket.on('customer:ready', (data) => {
      setConversationId(data.conversationId);
      setVisitorId(data.visitorId);
      const effectiveName = data.customerName || name || initialName || 'Customer';
      setName(effectiveName);
      setMessages(data.messages || []);
      setHasStarted(true);
      setIsClosed(false);

      // Save to sessionStorage for refresh resilience
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          visitorId: data.visitorId,
          name: effectiveName,
          email: email || initialEmail || ''
        })
      );
    });

    newSocket.on('message:new', (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m._id === msg._id)) return prev;
        return [...prev, msg];
      });
    });

    newSocket.on('message:read', () => {
      setMessages((prev) =>
        prev.map((m) => (m.readAt ? m : { ...m, readAt: new Date().toISOString() }))
      );
    });

    newSocket.on('typing', ({ from, typing }) => {
      if (from === 'agent') {
        setIsAgentTyping(Boolean(typing));
      }
    });

    newSocket.on('conversation:closed', () => {
      setIsClosed(true);
    });

    newSocket.on('app:error', (data) => {
      setAppError(data.message || 'Error occurred');
      setTimeout(() => setAppError(''), 4000);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [publicKey, loadingWorkspace, workspaceError]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAgentTyping]);

  const handleStartChat = (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || !socket) return;

    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        visitorId: visitorId || undefined,
        name: trimmedName,
        email: email.trim()
      })
    );

    socket.emit('customer:start', {
      name: trimmedName,
      email: email.trim(),
      visitorId: visitorId || undefined
    });
  };

  const handleInputChange = (e) => {
    setInputText(e.target.value);
    if (socket) {
      socket.emit('customer:typing', { typing: true });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('customer:typing', { typing: false });
      }, 1500);
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputText.trim() || !socket || isClosed) return;
    socket.emit('customer:message', { text: inputText.trim() });
    setInputText('');
    socket.emit('customer:typing', { typing: false });
  };

  const handleStartNewChat = () => {
    sessionStorage.removeItem(storageKey);
    setVisitorId('');
    setConversationId('');
    setMessages([]);
    setIsClosed(false);
    setHasStarted(false);
  };

  if (loadingWorkspace) {
    return (
      <div className="customer-chat-layout">
        <div style={{ color: 'var(--text-muted)' }}>Loading CogniDesk...</div>
      </div>
    );
  }

  if (workspaceError) {
    return (
      <div className="customer-chat-layout">
        <div className="card" style={{ maxWidth: '400px', textAlign: 'center', padding: '32px' }}>
          <h2 style={{ color: 'var(--danger)', marginBottom: '12px' }}>Workspace Not Found</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            The support link you used appears to be invalid or has expired. Please verify the URL with the business.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="customer-chat-layout" id="customer-chat-page">
      <div className="chat-widget-box">
        {/* Widget Header */}
        <div className="widget-header">
          <div>
            <h3>{workspaceName} Support</h3>
            <p>{connected ? '🟢 Support team is online' : '🟡 Connecting...'}</p>
          </div>
        </div>

        {/* Reconnecting Banner */}
        {isReconnecting && (
          <div className="reconnect-banner">
            Reconnecting to support...
          </div>
        )}

        {/* Transient Error Banner */}
        {appError && (
          <div style={{ background: '#b91c1c', color: '#fff', padding: '6px 12px', fontSize: '0.8rem', textAlign: 'center' }}>
            {appError}
          </div>
        )}

        {/* Guest Start Form */}
        {!hasStarted ? (
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
            <h4 style={{ color: '#fff', marginBottom: '8px', fontSize: '1.1rem' }}>How can we help?</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '20px' }}>
              Please enter your name to connect with our support agents.
            </p>

            <form onSubmit={handleStartChat}>
              <div className="form-group">
                <label>Your Name</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Email Address (Optional)</label>
                <input
                  type="email"
                  className="form-control"
                  placeholder="e.g. jane@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '8px' }} disabled={!connected}>
                Start Conversation
              </button>
            </form>
          </div>
        ) : (
          /* Live Chat Conversation View */
          <>
            <div className="messages-area" style={{ flex: 1, overflowY: 'auto' }}>
              {messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: '30px' }}>
                  Send a message to speak with {workspaceName} support.
                </div>
              ) : (
                messages.map((m) => {
                  const isAgent = m.senderType === 'agent';
                  return (
                    <div
                      key={m._id || m.createdAt}
                      className={`message-bubble-wrapper ${isAgent ? 'agent' : 'customer'}`}
                    >
                      <div className={`message-bubble ${isAgent ? 'agent' : 'customer'}`}>
                        {m.text}
                      </div>
                      <div className="message-meta">
                        <span>{m.senderName || (isAgent ? 'Support Agent' : name || 'Customer')}</span>
                        <span>•</span>
                        <span>{formatTime(m.createdAt)}</span>
                        {!isAgent && m.readAt && (
                          <>
                            <span>•</span>
                            <span className="seen-mark">✓ Seen</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Agent Typing Indicator */}
            {isAgentTyping && (
              <div className="typing-bar">
                <span>Support team is typing...</span>
              </div>
            )}

            {/* Closed State Banner or Input Bar */}
            {isClosed ? (
              <div style={{ padding: '16px', background: 'var(--bg-card)', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '10px' }}>
                  Chat closed. This conversation has been closed by support.
                </p>
                <button className="btn btn-primary" onClick={handleStartNewChat} style={{ fontSize: '0.85rem' }}>
                  Start a New Chat
                </button>
              </div>
            ) : (
              <form className="chat-input-bar" onSubmit={handleSendMessage}>
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={inputText}
                  onChange={handleInputChange}
                  maxLength={1000}
                  autoFocus
                />
                <button type="submit" className="btn btn-primary" disabled={!inputText.trim()}>
                  Send
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
