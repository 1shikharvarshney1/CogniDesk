import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/http.js';
import { useAuth } from '../context/AuthContext.jsx';

export function Onboarding() {
  const [tab, setTab] = useState('create'); // 'create' | 'join'
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { refreshUser } = useAuth();
  const navigate = useNavigate();

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.createWorkspace(name);
      await refreshUser();
      navigate('/');
    } catch (err) {
      setError(err.message || 'Failed to create workspace');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.joinWorkspace(joinCode.toUpperCase());
      await refreshUser();
      navigate('/');
    } catch (err) {
      setError(err.message || 'Failed to join workspace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '20px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '440px' }}>
        <h2 className="card-title" style={{ textAlign: 'center' }}>Welcome to SupportDesk</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', marginBottom: '20px' }}>
          To start responding to customers, set up or join a workspace.
        </p>

        <div className="conv-tabs" style={{ marginBottom: '20px' }}>
          <button
            className={`conv-tab ${tab === 'create' ? 'active' : ''}`}
            onClick={() => { setTab('create'); setError(''); }}
          >
            Create New Workspace
          </button>
          <button
            className={`conv-tab ${tab === 'join' ? 'active' : ''}`}
            onClick={() => { setTab('join'); setError(''); }}
          >
            Join with Code
          </button>
        </div>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        {tab === 'create' ? (
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>Workspace / Company Name</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Acme Corp Support"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} disabled={loading}>
              {loading ? 'Creating...' : 'Create Workspace'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoin}>
            <div className="form-group">
              <label>6-Character Join Code</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. ABC123"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                maxLength={6}
                required
                autoFocus
                style={{ textTransform: 'uppercase', letterSpacing: '2px' }}
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} disabled={loading}>
              {loading ? 'Joining...' : 'Join Workspace'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
