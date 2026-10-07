import React, { useState, useEffect } from 'react';
import { api } from '../api/http.js';

export function KnowledgeBase() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadArticles();
  }, []);

  const loadArticles = async () => {
    setLoading(true);
    try {
      const data = await api.getArticles();
      setArticles(data || []);
    } catch (err) {
      setError(err.message || 'Failed to load knowledge base articles');
    } finally {
      setLoading(false);
    }
  };

  const handleStartAdd = () => {
    setIsEditing(true);
    setEditId(null);
    setTitle('');
    setContent('');
    setError('');
  };

  const handleStartEdit = (article) => {
    setIsEditing(true);
    setEditId(article._id);
    setTitle(article.title);
    setContent(article.content);
    setError('');
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditId(null);
    setTitle('');
    setContent('');
    setError('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editId) {
        const updated = await api.updateArticle(editId, { title, content });
        setArticles((prev) => prev.map((a) => (a._id === editId ? updated : a)));
      } else {
        const created = await api.createArticle({ title, content });
        setArticles((prev) => [created, ...prev]);
      }
      handleCancel();
    } catch (err) {
      setError(err.message || 'Failed to save article');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this article?')) return;
    try {
      await api.deleteArticle(id);
      setArticles((prev) => prev.filter((a) => a._id !== id));
    } catch (err) {
      setError(err.message || 'Failed to delete article');
    }
  };

  return (
    <div className="page-container" id="knowledge-base-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="card-title" style={{ margin: 0 }}>Knowledge Base</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Articles stored here power the AI Copilot RAG search to answer customer questions accurately.
          </p>
        </div>
        {!isEditing && (
          <button className="btn btn-primary" onClick={handleStartAdd}>
            + Add New Article
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', padding: '12px 16px', borderRadius: 'var(--radius-sm)', marginBottom: '20px', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {isEditing && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '16px', color: '#fff', fontSize: '1.1rem' }}>
            {editId ? 'Edit Article' : 'New Knowledge Base Article'}
          </h3>
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label>Article Title</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Refund & Return Policy"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Article Content (Max 4,000 characters)</label>
              <textarea
                className="form-control"
                rows={6}
                placeholder="Detailed explanations, guidelines, terms, or answers..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={4000}
                required
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', alignSelf: 'flex-end' }}>
                {content.length}/4000
              </span>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : editId ? 'Save Changes' : 'Publish Article'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
          Loading knowledge base articles...
        </div>
      ) : articles.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
            No articles in this workspace yet. Add knowledge base articles to enable AI-powered customer replies.
          </p>
          <button className="btn btn-primary" onClick={handleStartAdd}>
            Add First Article
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {articles.map((article) => (
            <div key={article._id} className="card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <h3 style={{ fontSize: '1.05rem', color: '#fff', fontWeight: 600 }}>{article.title}</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                    onClick={() => handleStartEdit(article)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                    onClick={() => handleDelete(article._id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                {article.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
