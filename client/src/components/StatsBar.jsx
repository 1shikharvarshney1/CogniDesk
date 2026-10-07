import React, { useEffect, useState } from 'react';
import { api } from '../api/http.js';
import { useSocket } from '../context/SocketContext.jsx';

function formatResponseTime(ms) {
  if (!ms || ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 1) return '1s';
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSec = totalSeconds % 60;
  return remainingSec > 0 ? `${minutes}m ${remainingSec}s` : `${minutes}m`;
}

export function StatsBar() {
  const { socket } = useSocket();
  const [stats, setStats] = useState({ open: 0, unassigned: 0, avgFirstResponseMs: 0 });

  useEffect(() => {
    let mounted = true;
    async function loadStats() {
      try {
        const data = await api.getStats();
        if (mounted) setStats(data);
      } catch (err) {
        console.warn('Failed to load initial stats:', err.message);
      }
    }
    loadStats();

    if (socket) {
      const handleStatsUpdate = (newStats) => {
        if (mounted) setStats(newStats);
      };
      socket.on('stats:update', handleStatsUpdate);
      return () => {
        mounted = false;
        socket.off('stats:update', handleStatsUpdate);
      };
    }

    return () => {
      mounted = false;
    };
  }, [socket]);

  return (
    <div className="stats-bar" id="stats-bar">
      <div className="stat-item">
        <span className="stat-pill">
          Open Chats: <strong>{stats.open}</strong>
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-pill">
          Unassigned: <strong>{stats.unassigned}</strong>
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-pill">
          Avg First Response: <strong>{formatResponseTime(stats.avgFirstResponseMs)}</strong>
        </span>
      </div>
    </div>
  );
}
