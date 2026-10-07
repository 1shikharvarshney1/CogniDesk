import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ConversationList({
  conversations = [],
  selectedId,
  onSelectConversation,
  presenceMap = {}
}) {
  const { user } = useAuth();
  const [tab, setTab] = useState('all'); // all | unassigned | mine | closed

  const filtered = conversations.filter((c) => {
    if (tab === 'closed') return c.status === 'closed';
    if (c.status === 'closed') return false; // Open tabs only
    if (tab === 'unassigned') return !c.assignee;
    if (tab === 'mine') return c.assignee?._id === user?.id || c.assignee === user?.id;
    return true; // 'all' open
  });

  return (
    <div className="conv-list-panel" id="conversation-list-panel">
      <div className="conv-tabs">
        <button
          className={`conv-tab ${tab === 'all' ? 'active' : ''}`}
          onClick={() => setTab('all')}
        >
          All
        </button>
        <button
          className={`conv-tab ${tab === 'unassigned' ? 'active' : ''}`}
          onClick={() => setTab('unassigned')}
        >
          Unassigned
        </button>
        <button
          className={`conv-tab ${tab === 'mine' ? 'active' : ''}`}
          onClick={() => setTab('mine')}
        >
          Mine
        </button>
        <button
          className={`conv-tab ${tab === 'closed' ? 'active' : ''}`}
          onClick={() => setTab('closed')}
        >
          Closed
        </button>
      </div>

      <div className="conv-items-scroll">
        {filtered.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            No conversations found in this view.
          </div>
        ) : (
          filtered.map((conv) => {
            const isSelected = conv._id === selectedId;
            const isOnline = Boolean(presenceMap[conv._id]);
            const sentiment = conv.sentiment || 'calm';

            return (
              <div
                key={conv._id}
                className={`conv-item ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectConversation(conv)}
              >
                <div className="conv-item-header">
                  <div className="conv-customer-name">
                    <span className={`online-dot ${isOnline ? 'online' : ''}`} title={isOnline ? 'Online' : 'Offline'} />
                    <span className={`sentiment-dot ${sentiment}`} title={`Sentiment: ${sentiment}`} />
                    <span>{conv.customerName}</span>
                  </div>
                  <span className="conv-time">{formatTime(conv.lastMessageAt || conv.createdAt)}</span>
                </div>

                <div className="conv-snippet">
                  {conv.lastMessageText || 'No messages yet'}
                </div>

                <div className="conv-badge-row">
                  {conv.unreadForAgents > 0 && (
                    <span className="unread-badge">{conv.unreadForAgents} new</span>
                  )}
                  {conv.assignee && (
                    <span className="assignee-badge">
                      Assigned: {conv.assignee.username || 'Agent'}
                    </span>
                  )}
                  {conv.status === 'closed' && (
                    <span className="assignee-badge" style={{ color: 'var(--text-dim)' }}>
                      Closed
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
