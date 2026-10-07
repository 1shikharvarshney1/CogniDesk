import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext.jsx';

export function AiPanel({ conversation, onUseSuggestion }) {
  const { socket } = useSocket();
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [suggestion, setSuggestion] = useState(null);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    // Reset suggestion state on switching conversations
    setSuggestion(null);
    setAiError('');
    setLoading(false);
  }, [conversation?._id]);

  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setInterval(() => {
        setCooldown((c) => Math.max(0, c - 1));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!socket) return;

    const handleSuggestion = (data) => {
      if (data.conversationId === conversation?._id) {
        setSuggestion(data);
        setAiError('');
        setLoading(false);
      }
    };

    const handleAiError = (data) => {
      setLoading(false);
      setAiError(data?.message || 'AI assistant encountered an issue.');
    };

    socket.on('ai:suggestion', handleSuggestion);
    socket.on('ai:error', handleAiError);

    return () => {
      socket.off('ai:suggestion', handleSuggestion);
      socket.off('ai:error', handleAiError);
    };
  }, [socket, conversation?._id]);

  const handleRequestSuggestion = () => {
    if (!socket || !conversation?._id || cooldown > 0 || loading) return;
    setLoading(true);
    setAiError('');
    setCooldown(5); // 5-second cooldown
    socket.emit('agent:suggest', { conversationId: conversation._id });
  };

  if (!conversation) {
    return (
      <div className="ai-panel">
        <div style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '40px', fontSize: '0.85rem' }}>
          Select a chat to see AI assistance and metrics.
        </div>
      </div>
    );
  }

  const sentiment = suggestion?.sentiment || conversation.sentiment || 'calm';
  const urgency = suggestion?.urgency || conversation.urgency || 'low';

  return (
    <div className="ai-panel" id="ai-panel">
      <div className="ai-panel-header">
        <h3 className="ai-panel-title">
          <span>⚡ AI Copilot</span>
        </h3>
        <button
          className="btn btn-primary"
          style={{ fontSize: '0.8rem', padding: '6px 12px' }}
          onClick={handleRequestSuggestion}
          disabled={loading || cooldown > 0 || conversation.status === 'closed'}
        >
          {loading
            ? 'Analyzing...'
            : cooldown > 0
            ? `Cooldown (${cooldown}s)`
            : 'Suggest Reply'}
        </button>
      </div>

      <div className="ai-tags-row">
        <span className={`tag-badge ${sentiment}`}>
          Sentiment: {sentiment}
        </span>
        <span className={`tag-badge ${urgency}`}>
          Urgency: {urgency}
        </span>
      </div>

      {aiError && (
        <div className="suggestion-card" style={{ borderColor: 'var(--danger)' }}>
          <p style={{ color: 'var(--danger)', margin: 0 }}>{aiError}</p>
        </div>
      )}

      {suggestion && (
        <div className="suggestion-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
              Drafted Reply ({suggestion.provider})
            </span>
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '3px 8px' }}
              onClick={() => onUseSuggestion(suggestion.reply)}
            >
              Use Draft ↵
            </button>
          </div>
          <p>{suggestion.reply}</p>

          {suggestion.sources && suggestion.sources.length > 0 && (
            <div className="sources-list">
              Sources used: <span>{suggestion.sources.join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {conversation.summary ? (
        <div className="summary-card">
          <h4>Resolution Summary</h4>
          <p>{conversation.summary}</p>
        </div>
      ) : conversation.status === 'closed' ? (
        <div className="summary-card" style={{ opacity: 0.7 }}>
          <h4>Resolution Summary</h4>
          <p style={{ fontStyle: 'italic', fontSize: '0.8rem' }}>Generating automated summary...</p>
        </div>
      ) : null}
    </div>
  );
}
