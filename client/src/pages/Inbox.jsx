import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/http.js';
import { useSocket } from '../context/SocketContext.jsx';
import { StatsBar } from '../components/StatsBar.jsx';
import { ConversationList } from '../components/ConversationList.jsx';
import { ChatWindow } from '../components/ChatWindow.jsx';
import { AiPanel } from '../components/AiPanel.jsx';

export function Inbox() {
  const { socket } = useSocket();
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isCustomerTyping, setIsCustomerTyping] = useState(false);
  const [presenceMap, setPresenceMap] = useState({});
  const [inputText, setInputText] = useState('');
  const typingTimerRef = useRef(null);

  // Load conversations on mount
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const list = await api.getConversations();
        if (!mounted) return;
        setConversations(list);

        // Restore selected conversation from sessionStorage if available
        const savedId = sessionStorage.getItem('cognidesk_selected_conv') || sessionStorage.getItem('supportdesk_selected_conv');
        const match = list.find((c) => c._id === savedId) || list[0];
        if (match) {
          handleSelectConversation(match);
        }
      } catch (err) {
        console.warn('Failed to load conversations:', err.message);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  // Listen to Socket.io events
  useEffect(() => {
    if (!socket) return;

    // conversation:new -> new chat appeared
    const handleNewConv = (newConv) => {
      setConversations((prev) => {
        if (prev.some((c) => c._id === newConv._id)) return prev;
        return [newConv, ...prev];
      });
    };

    // conversation:updated -> unread count, summary, assignee, sentiment, etc.
    const handleConvUpdated = (updated) => {
      setConversations((prev) =>
        prev.map((c) => (c._id === updated._id ? { ...c, ...updated } : c))
      );
      setSelectedConv((curr) => {
        if (curr?._id === updated._id) {
          return { ...curr, ...updated };
        }
        return curr;
      });
    };

    // message:new -> new message arrived
    const handleNewMessage = (msg) => {
      setSelectedConv((curr) => {
        if (curr && (msg.conversation === curr._id || msg.conversation?._id === curr._id)) {
          setMessages((prevMsgs) => {
            if (prevMsgs.some((m) => m._id === msg._id)) return prevMsgs;
            return [...prevMsgs, msg];
          });
        }
        return curr;
      });
    };

    // message:read -> mark messages as read
    const handleMessageRead = ({ conversationId }) => {
      setSelectedConv((curr) => {
        if (curr?._id === conversationId) {
          setMessages((prev) =>
            prev.map((m) => (m.readAt ? m : { ...m, readAt: new Date().toISOString() }))
          );
        }
        return curr;
      });
    };

    // typing -> customer typing indicator
    const handleTyping = ({ from, typing }) => {
      if (from === 'customer') {
        setIsCustomerTyping(Boolean(typing));
        clearTimeout(typingTimerRef.current);
        if (typing) {
          typingTimerRef.current = setTimeout(() => {
            setIsCustomerTyping(false);
          }, 3000);
        }
      }
    };

    // customer:presence -> online / offline status
    const handlePresence = ({ conversationId, online }) => {
      setPresenceMap((prev) => ({ ...prev, [conversationId]: online }));
    };

    socket.on('conversation:new', handleNewConv);
    socket.on('conversation:updated', handleConvUpdated);
    socket.on('message:new', handleNewMessage);
    socket.on('message:read', handleMessageRead);
    socket.on('typing', handleTyping);
    socket.on('customer:presence', handlePresence);

    return () => {
      socket.off('conversation:new', handleNewConv);
      socket.off('conversation:updated', handleConvUpdated);
      socket.off('message:new', handleNewMessage);
      socket.off('message:read', handleMessageRead);
      socket.off('typing', handleTyping);
      socket.off('customer:presence', handlePresence);
    };
  }, [socket]);

  const handleSelectConversation = (conv) => {
    if (!conv) return;
    setSelectedConv(conv);
    sessionStorage.setItem('cognidesk_selected_conv', conv._id);
    setIsCustomerTyping(false);

    // Call agent:open via socket if available
    if (socket) {
      socket.emit('agent:open', { conversationId: conv._id });
      socket.once('agent:opened', ({ conversation: updated, messages: loadedMsgs }) => {
        setSelectedConv(updated);
        setMessages(loadedMsgs || []);
      });
    } else {
      // Fallback to REST API
      api.getConversationMessages(conv._id).then((msgs) => setMessages(msgs || []));
    }
  };

  const handleSendMessage = (text) => {
    if (!socket || !selectedConv?._id) return;
    socket.emit('agent:message', { conversationId: selectedConv._id, text });
  };

  const handleClaim = () => {
    if (!socket || !selectedConv?._id) return;
    socket.emit('agent:claim', { conversationId: selectedConv._id });
  };

  const handleCloseConversation = () => {
    if (!socket || !selectedConv?._id) return;
    socket.emit('agent:close', { conversationId: selectedConv._id });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 61px)' }}>
      <StatsBar />
      <div className="inbox-layout">
        <ConversationList
          conversations={conversations}
          selectedId={selectedConv?._id}
          onSelectConversation={handleSelectConversation}
          presenceMap={presenceMap}
        />
        <ChatWindow
          conversation={selectedConv}
          messages={messages}
          onSendMessage={handleSendMessage}
          onClaim={handleClaim}
          onCloseConversation={handleCloseConversation}
          isCustomerTyping={isCustomerTyping}
          inputText={inputText}
          setInputText={setInputText}
        />
        <AiPanel
          conversation={selectedConv}
          onUseSuggestion={(suggestedText) => setInputText(suggestedText)}
        />
      </div>
    </div>
  );
}
