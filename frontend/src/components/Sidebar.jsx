import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  FiHome, 
  FiMail, 
  FiCalendar, 
  FiUsers, 
  FiZap 
} from 'react-icons/fi';

const Sidebar = () => {
  const navItems = [
    { path: '/', label: 'Dashboard', icon: FiHome },
    { path: '/emails', label: 'Processed Emails', icon: FiMail },
    { path: '/events', label: 'Calendar Events', icon: FiCalendar },
    { path: '/accounts', label: 'Gmail Accounts', icon: FiUsers },
  ];

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <div className="brand-logo">
          <FiZap className="brand-icon" />
        </div>
        <div className="brand-text">
          <h2>AutoCal AI</h2>
          <span>Email to Calendar</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `nav-link ${isActive ? 'active' : ''}`
              }
              end={item.path === '/'}
            >
              <Icon className="nav-icon" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="poller-status">
          <span className="pulse-dot"></span>
          <div className="status-text">
            <strong>Auto-Poller Active</strong>
            <small>Runs every 2 mins</small>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
