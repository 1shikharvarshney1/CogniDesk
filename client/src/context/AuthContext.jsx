import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, getToken, setToken, getStoredUser, setStoredUser } from '../api/http.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => getToken());
  const [user, setUserState] = useState(() => getStoredUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMe() {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await api.getMe();
        setUserState(res.user);
        setStoredUser(res.user);
      } catch (err) {
        console.warn('Failed to load user session:', err.message);
        logout();
      } finally {
        setLoading(false);
      }
    }
    loadMe();
  }, [token]);

  const login = async (email, password) => {
    const data = await api.login({ email, password });
    setToken(data.token);
    setStoredUser(data.user);
    setTokenState(data.token);
    setUserState(data.user);
    return data;
  };

  const register = async (username, email, password) => {
    const data = await api.register({ username, email, password });
    setToken(data.token);
    setStoredUser(data.user);
    setTokenState(data.token);
    setUserState(data.user);
    return data;
  };

  const logout = () => {
    setToken(null);
    setStoredUser(null);
    setTokenState(null);
    setUserState(null);
  };

  const refreshUser = async () => {
    if (!token) return null;
    const res = await api.getMe();
    setUserState(res.user);
    setStoredUser(res.user);
    return res.user;
  };

  return (
    <AuthContext.Provider value={{ token, user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
