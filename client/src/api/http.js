const API_BASE = '/api';

export function getToken() {
  return sessionStorage.getItem('supportdesk_token');
}

export function setToken(token) {
  if (token) {
    sessionStorage.setItem('supportdesk_token', token);
  } else {
    sessionStorage.removeItem('supportdesk_token');
  }
}

export function getStoredUser() {
  const raw = sessionStorage.getItem('supportdesk_user');
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) {
    sessionStorage.setItem('supportdesk_user', JSON.stringify(user));
  } else {
    sessionStorage.removeItem('supportdesk_user');
  }
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || `HTTP error ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

export const api = {
  // Auth
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  getMe: () => request('/auth/me'),

  // Workspace
  createWorkspace: (name) => request('/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),
  joinWorkspace: (joinCode) => request('/workspaces/join', { method: 'POST', body: JSON.stringify({ joinCode }) }),
  getMyWorkspace: () => request('/workspace'),

  // Conversations
  getConversations: (status) => request(status ? `/conversations?status=${status}` : '/conversations'),
  getConversationMessages: (id) => request(`/conversations/${id}/messages`),

  // Knowledge Base Articles
  getArticles: () => request('/articles'),
  createArticle: (body) => request('/articles', { method: 'POST', body: JSON.stringify(body) }),
  updateArticle: (id, body) => request(`/articles/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteArticle: (id) => request(`/articles/${id}`, { method: 'DELETE' }),

  // Stats
  getStats: () => request('/stats'),

  // Public
  getPublicWorkspace: (publicKey) => request(`/public/${publicKey}`)
};
