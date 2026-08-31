import React from 'react';
import Sidebar from './Sidebar';
import Navbar from './Navbar';

const Layout = ({ title, children }) => {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main-wrapper">
        <Navbar title={title} />
        <main className="app-content-area">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
