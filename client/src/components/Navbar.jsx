import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="navbar" id="app-navbar">
      <NavLink to="/" className="navbar-brand">
        <div className="logo-icon">CD</div>
        <span>CogniDesk</span>
      </NavLink>

      <div className="navbar-links">
        <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Inbox
        </NavLink>
        <NavLink to="/kb" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Knowledge Base
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          Settings
        </NavLink>
      </div>

      <div className="navbar-user">
        {user && (
          <span className="user-badge" title={user.email}>
            <strong>{user.username}</strong>
            {user.workspace?.name ? ` • ${user.workspace.name}` : ''}
          </span>
        )}
        <button className="btn btn-secondary" onClick={handleLogout} style={{ padding: '4px 10px', fontSize: '0.8rem' }}>
          Log Out
        </button>
      </div>
    </nav>
  );
}
