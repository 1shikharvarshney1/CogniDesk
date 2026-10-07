import React, { useState, useEffect } from 'react';
import { api } from '../api/http.js';

export function Settings() {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedKey, setCopiedKey] = useState('');

  useEffect(() => {
    async function loadWorkspace() {
      try {
        const data = await api.getMyWorkspace();
        setWorkspace(data);
      } catch (err) {
        setError(err.message || 'Failed to load workspace settings');
      } finally {
        setLoading(false);
      }
    }
    loadWorkspace();
  }, []);

  const handleCopy = (key, text) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey('');
    }, 2500);
  };

  if (loading) {
    return (
      <div className="page-container" style={{ textAlign: 'center', paddingTop: '60px', color: 'var(--text-dim)' }}>
        Loading workspace settings...
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="page-container">
        <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
          {error || 'Unable to load workspace.'}
        </div>
      </div>
    );
  }

  const origin = window.location.origin;
  const publicChatLink = `${origin}/chat/${workspace.publicKey}`;
  const iframeSnippet = `<iframe src="${publicChatLink}" width="360" height="520" frameborder="0"></iframe>`;

  return (
    <div className="page-container" id="settings-page">
      <h1 className="card-title">Workspace Settings</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '0.9rem' }}>
        Manage your workspace credentials, agent invites, and embeddable customer chat widget.
      </p>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Workspace Name */}
        <div className="form-group" style={{ margin: 0 }}>
          <label>Workspace Name</label>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>
            {workspace.name}
          </div>
        </div>

        {/* Join Code for Agents */}
        <div className="form-group" style={{ margin: 0 }}>
          <label>Agent Join Code</label>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '8px' }}>
            Share this 6-character code with other agents to join this workspace.
          </p>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 14px',
              fontFamily: 'monospace',
              fontSize: '1.1rem',
              fontWeight: 700,
              letterSpacing: '3px',
              color: 'var(--primary)'
            }}>
              {workspace.joinCode}
            </span>
            <button
              className="btn btn-secondary"
              onClick={() => handleCopy('joinCode', workspace.joinCode)}
            >
              {copiedKey === 'joinCode' ? '✓ Copied' : 'Copy Code'}
            </button>
          </div>
        </div>

        {/* Public Chat URL */}
        <div className="form-group" style={{ margin: 0 }}>
          <label>Public Customer Chat URL</label>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '8px' }}>
            Direct URL your customers can open in any browser to start a support conversation.
          </p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              readOnly
              className="form-control"
              value={publicChatLink}
              style={{ flex: 1, color: 'var(--text-muted)' }}
            />
            <button
              className="btn btn-secondary"
              onClick={() => handleCopy('link', publicChatLink)}
            >
              {copiedKey === 'link' ? '✓ Copied' : 'Copy Link'}
            </button>
          </div>
        </div>

        {/* Iframe Embed Snippet */}
        <div className="form-group" style={{ margin: 0 }}>
          <label>Embeddable Iframe Widget Snippet</label>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '8px' }}>
            Paste this snippet into your website's HTML to embed the customer chat widget.
          </p>
          <textarea
            readOnly
            rows={3}
            className="form-control"
            value={iframeSnippet}
            style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-muted)', resize: 'none' }}
          />
          <div style={{ marginTop: '8px' }}>
            <button
              className="btn btn-secondary"
              onClick={() => handleCopy('iframe', iframeSnippet)}
            >
              {copiedKey === 'iframe' ? '✓ Copied' : 'Copy Iframe Code'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
