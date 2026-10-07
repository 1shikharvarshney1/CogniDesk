import React from 'react';

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageBubble({ message }) {
  const isAgent = message.senderType === 'agent';

  return (
    <div className={`message-bubble-wrapper ${isAgent ? 'agent' : 'customer'}`}>
      <div className={`message-bubble ${isAgent ? 'agent' : 'customer'}`}>
        {message.text}
      </div>
      <div className="message-meta">
        <span>{message.senderName || (isAgent ? 'Agent' : 'Customer')}</span>
        <span>•</span>
        <span>{formatTime(message.createdAt)}</span>
        {isAgent && message.readAt && (
          <>
            <span>•</span>
            <span className="seen-mark" title={`Seen at ${formatTime(message.readAt)}`}>✓ Seen</span>
          </>
        )}
      </div>
    </div>
  );
}
