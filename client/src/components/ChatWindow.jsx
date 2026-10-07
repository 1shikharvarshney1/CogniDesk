import React, { useState, useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';

export function ChatWindow({
  conversation,
  messages = [],
  onSendMessage,
  onClaim,
  onCloseConversation,
  isCustomerTyping = false,
  inputText,
  setInputText
}) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isCustomerTyping]);

  const handleInputChange = (e) => {
    setInputText(e.target.value);

    // Relay agent typing indicator
    if (socket && conversation?._id) {
      socket.emit('agent:typing', { conversationId: conversation._id, typing: true });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('agent:typing', { conversationId: conversation._id, typing: false });
      }, 1500);
    }
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim() || !conversation?._id) return;
    onSendMessage(inputText.trim());
    setInputText('');
    if (socket && conversation?._id) {
      socket.emit('agent:typing', { conversationId: conversation._id, typing: false });
    }
  };

  if (!conversation) {
    return (
      <div className="chat-window" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-dim)' }}>Select a conversation from the left to view messages</p>
      </div>
    );
  }

  const isClosed = conversation.status === 'closed';
  const isAssignedToMe = conversation.assignee?._id === user?.id || conversation.assignee === user?.id;

  return (
    <div className="chat-window" id="chat-window">
      <div className="chat-header">
        <div className="chat-customer-info">
          <h2>{conversation.customerName}</h2>
          <p>{conversation.customerEmail || 'Guest visitor'} • Session ID: {conversation.visitorId}</p>
        </div>

        <div className="chat-actions">
          {!isClosed && !isAssignedToMe && (
            <button className="btn btn-secondary" onClick={onClaim}>
              Claim Chat
            </button>
          )}
          {!isClosed && (
            <button className="btn btn-danger" onClick={onCloseConversation}>
              Close Chat
            </button>
          )}
          {isClosed && (
            <span className="assignee-badge" style={{ color: 'var(--text-dim)', padding: '6px 12px' }}>
              Conversation Closed
            </span>
          )}
        </div>
      </div>

      <div className="messages-area">
        {messages.map((msg) => (
          <MessageBubble key={msg._id || msg.createdAt} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {isCustomerTyping && (
        <div className="typing-bar">
          <span>{conversation.customerName} is typing...</span>
        </div>
      )}

      {!isClosed ? (
        <form className="chat-input-bar" onSubmit={handleSend}>
          <input
            type="text"
            placeholder="Type your reply here..."
            value={inputText}
            onChange={handleInputChange}
            maxLength={1000}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={!inputText.trim()}>
            Send
          </button>
        </form>
      ) : (
        <div className="chat-input-bar" style={{ justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          This conversation is closed.
        </div>
      )}
    </div>
  );
}
