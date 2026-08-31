import React from 'react';
import { useAuth } from '../context/AuthContext';
import { FiLogOut, FiUser, FiCheckCircle } from 'react-icons/fi';

const Navbar = ({ title }) => {
  const { user, logout } = useAuth();

  const primaryEmail = user?.accounts?.[0]?.email || user?.email || 'User';

  return (
    <header className="app-navbar">
      <div className="navbar-title">
        <h1>{title}</h1>
      </div>

      <div className="navbar-actions">
        <div className="account-badge">
          <FiCheckCircle className="badge-icon text-success" />
          <span>{user?.accounts?.length || 0} Account(s) Connected</span>
        </div>

        <div className="user-profile">
          <div className="user-avatar">
            {user?.name ? user.name.charAt(0).toUpperCase() : <FiUser />}
          </div>
          <div className="user-details">
            <span className="user-name">{user?.name || 'User'}</span>
            <span className="user-email">{primaryEmail}</span>
          </div>

          <button 
            onClick={logout} 
            className="btn btn-outline btn-sm logout-btn" 
            title="Log Out"
          >
            <FiLogOut />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
