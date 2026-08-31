import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { accountsApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { 
  FiUsers, 
  FiPlus, 
  FiTrash2, 
  FiCheckCircle, 
  FiClock, 
  FiRefreshCw, 
  FiShield, 
  FiMail 
} from 'react-icons/fi';
import toast from 'react-hot-toast';

const Accounts = () => {
  const { user, refreshUser } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const res = await accountsApi.list();
      if (res.data?.success) {
        setAccounts(res.data.data || []);
      }
    } catch (err) {
      toast.error('Failed to load linked accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleLinkNewAccount = async () => {
    try {
      const res = await accountsApi.linkAccount();
      if (res.data?.success && res.data?.data?.url) {
        window.location.href = res.data.data.url;
      } else {
        toast.error('Failed to start account linking');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to initiate account linking');
    }
  };

  const handleUnlink = async (accountId, email) => {
    if (!window.confirm(`Are you sure you want to unlink ${email}? New emails from this account will no longer be tracked.`)) {
      return;
    }

    try {
      const res = await accountsApi.unlink(accountId);
      if (res.data?.success) {
        toast.success(`Unlinked ${email}`);
        fetchAccounts();
        refreshUser();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to unlink account');
    }
  };

  return (
    <Layout title="Linked Gmail Accounts">
      <div className="page-content">
        <div className="page-header-row">
          <div>
            <h2>Multi-Inbox Management</h2>
            <p>Connect multiple Gmail inboxes. AutoCal AI continuously monitors all connected accounts for scheduling emails.</p>
          </div>

          <button 
            className="btn btn-primary btn-icon-text"
            onClick={handleLinkNewAccount}
          >
            <FiPlus />
            <span>Link Another Gmail</span>
          </button>
        </div>

        <div className="info-banner">
          <FiShield className="info-icon" />
          <div className="info-text">
            <strong>Calendar Destination Rule:</strong>
            <span> Events extracted from all linked inboxes will be saved to your <u>Primary Google Account's Calendar</u>.</span>
          </div>
        </div>

        <div className="accounts-grid">
          {loading ? (
            <div className="text-center py-5 w-100">
              <div className="spinner"></div>
              <p className="mt-2 text-muted">Loading linked inboxes...</p>
            </div>
          ) : accounts.length === 0 ? (
            <div className="empty-state w-100">
              <FiMail className="empty-icon" />
              <h3>No Accounts Linked</h3>
              <p>Link your first Gmail account to begin automated event scanning.</p>
            </div>
          ) : (
            accounts.map((acc, index) => {
              const isPrimary = index === 0;
              return (
                <div key={acc._id} className="account-card">
                  <div className="account-card-header">
                    <div className="account-avatar">
                      <FiMail />
                    </div>
                    <div className="account-info">
                      <div className="account-title-row">
                        <h4>{acc.email}</h4>
                        {isPrimary && <span className="badge badge-primary">Primary Account</span>}
                      </div>
                      <span className="account-status">
                        <span className="pulse-dot"></span>
                        {acc.isActive ? 'Actively Monitored' : 'Inactive'}
                      </span>
                    </div>
                  </div>

                  <div className="account-card-body">
                    <div className="acc-stat-item">
                      <span className="stat-label"><FiClock /> Linked On</span>
                      <span className="stat-value">{new Date(acc.linkedAt).toLocaleDateString()}</span>
                    </div>
                    <div className="acc-stat-item">
                      <span className="stat-label"><FiRefreshCw /> Last Polled</span>
                      <span className="stat-value">
                        {acc.lastPolledAt ? new Date(acc.lastPolledAt).toLocaleTimeString() : 'Pending first poll'}
                      </span>
                    </div>
                    <div className="acc-stat-item">
                      <span className="stat-label"><FiShield /> Token State</span>
                      <span className="stat-value text-success">AES-256 Encrypted</span>
                    </div>
                  </div>

                  <div className="account-card-footer">
                    {!isPrimary ? (
                      <button 
                        className="btn btn-sm btn-outline-danger w-100"
                        onClick={() => handleUnlink(acc._id, acc.email)}
                      >
                        <FiTrash2 /> Unlink Account
                      </button>
                    ) : (
                      <span className="primary-note text-muted">Primary account cannot be unlinked (used for login)</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Layout>
  );
};

export default Accounts;
