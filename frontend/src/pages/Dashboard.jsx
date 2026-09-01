import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { emailsApi, eventsApi, accountsApi } from '../services/api';
import { 
  FiMail, 
  FiCalendar, 
  FiUsers, 
  FiCheckCircle, 
  FiClock, 
  FiRefreshCw, 
  FiExternalLink,
  FiPlusCircle,
  FiAlertCircle
} from 'react-icons/fi';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';

const Dashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    totalEmailsScanned: 0,
    totalThreads: 0,
    totalEvents: 0,
    syncedEvents: 0,
    rescheduledEvents: 0,
    cancelledEvents: 0,
    accountsCount: user?.accounts?.length || 0,
    lastScanTime: null,
  });
  const [recentEmails, setRecentEmails] = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboardData = async (showToast = false) => {
    try {
      if (showToast) setRefreshing(true);
      else setLoading(true);

      const [emailsRes, eventsRes, accountsRes, statsRes] = await Promise.allSettled([
        emailsApi.list({ page: 1, limit: 5 }),
        eventsApi.list({ page: 1, limit: 5, status: 'scheduled' }),
        accountsApi.list(),
        eventsApi.getStats(),
      ]);

      let emailCount = 0;
      let eventCount = 0;
      let accountCount = user?.accounts?.length || 0;

      if (emailsRes.status === 'fulfilled' && emailsRes.value?.data?.success) {
        setRecentEmails(emailsRes.value.data.data.threads || []);
        emailCount = emailsRes.value.data.data.pagination?.total || 0;
      }

      if (eventsRes.status === 'fulfilled' && eventsRes.value?.data?.success) {
        setUpcomingEvents(eventsRes.value.data.data.events || []);
        eventCount = eventsRes.value.data.data.pagination?.total || 0;
      }

      if (accountsRes.status === 'fulfilled' && accountsRes.value?.data?.success) {
        accountCount = accountsRes.value.data.data?.length || 0;
      }

      let detailedStats = {
        totalEmailsScanned: emailCount,
        totalThreads: emailCount,
        totalEvents: eventCount,
        syncedEvents: eventCount,
        rescheduledEvents: 0,
        cancelledEvents: 0,
        accountsCount: accountCount,
        lastScanTime: null,
      };

      if (statsRes.status === 'fulfilled' && statsRes.value?.data?.success) {
        const s = statsRes.value.data.data;
        detailedStats = {
          totalEmailsScanned: s.totalEmailsScanned || emailCount,
          totalThreads: s.totalThreads || emailCount,
          totalEvents: s.totalEvents || eventCount,
          syncedEvents: s.syncedEvents || eventCount,
          rescheduledEvents: s.rescheduledEvents || 0,
          cancelledEvents: s.cancelledEvents || 0,
          accountsCount: s.activeAccounts || accountCount,
          lastScanTime: s.lastScanTime,
        };
      }

      setStats(detailedStats);

      if (showToast) toast.success('Dashboard refreshed!');
    } catch (err) {
      console.error('Error loading dashboard:', err);
      toast.error('Failed to load some dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const handleAddToCalendar = async (eventId) => {
    try {
      const res = await eventsApi.addToCalendar(eventId);
      if (res.data?.success) {
        toast.success('Event synced to Google Calendar!');
        loadDashboardData();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to sync event');
    }
  };

  const [scanning, setScanning] = useState(false);

  const handleScanInboxes = async () => {
    try {
      setScanning(true);
      toast.loading('Scanning all connected inboxes with Gemini AI...', { id: 'scanToast' });
      const res = await emailsApi.scan();
      if (res.data?.success) {
        toast.success(res.data.message || 'Inboxes scanned successfully!', { id: 'scanToast' });
        loadDashboardData(false);
      }
    } catch (err) {
      toast.error('Failed to scan inboxes', { id: 'scanToast' });
    } finally {
      setScanning(false);
    }
  };

  return (
    <Layout title="Dashboard Overview">
      <div className="dashboard-content">
        {/* Top welcome banner */}
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Welcome back, {user?.name || 'User'}! 👋</h2>
            <p>
              AutoCal AI is actively monitoring your connected inboxes. 
              New calendar invitations and updates will automatically sync to your primary calendar.
            </p>
          </div>
          <div className="welcome-actions">
            <button 
              className="btn btn-primary btn-icon-text"
              onClick={handleScanInboxes}
              disabled={scanning || refreshing}
            >
              <FiRefreshCw className={scanning ? 'spin' : ''} />
              <span>{scanning ? 'Scanning...' : 'Scan Inboxes'}</span>
            </button>
            <button 
              className="btn btn-secondary btn-icon-text"
              onClick={() => loadDashboardData(true)}
              disabled={refreshing || scanning}
            >
              <FiRefreshCw className={refreshing ? 'spin' : ''} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
            <Link to="/accounts" className="btn btn-secondary btn-icon-text">
              <FiPlusCircle />
              <span>Link Account</span>
            </Link>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon-wrapper stat-primary">
              <FiMail />
            </div>
            <div className="stat-details">
              <span className="stat-label">Emails Scanned</span>
              <h3 className="stat-value">{stats.totalEmailsScanned}</h3>
              <span className="stat-subtext">{stats.totalThreads} Threads Analyzed</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper stat-success">
              <FiCalendar />
            </div>
            <div className="stat-details">
              <span className="stat-label">Events Added</span>
              <h3 className="stat-value">{stats.totalEvents}</h3>
              <span className="stat-subtext">{stats.syncedEvents} Synced to Google Cal</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper stat-warning">
              <FiUsers />
            </div>
            <div className="stat-details">
              <span className="stat-label">Linked Inboxes</span>
              <h3 className="stat-value">{stats.accountsCount}</h3>
              <span className="stat-subtext">Active monitoring</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper stat-info">
              <FiCheckCircle />
            </div>
            <div className="stat-details">
              <span className="stat-label">Automation Status</span>
              <h3 className="stat-value text-success">Active</h3>
              <span className="stat-subtext">
                {stats.lastScanTime ? `Last scan: ${new Date(stats.lastScanTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Cron: Every 2 Mins'}
              </span>
            </div>
          </div>
        </div>

        {/* Sync Summary & Quick Insights Bar */}
        <div className="card-section" style={{
          background: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary, #1e293b)' }}>
              📊 Sync Insights:
            </span>
            <span className="badge badge-success">
              ✓ {stats.syncedEvents} Calendar Events Synced
            </span>
            {stats.rescheduledEvents > 0 && (
              <span className="badge badge-warning">
                🔄 {stats.rescheduledEvents} Rescheduled
              </span>
            )}
            {stats.cancelledEvents > 0 && (
              <span className="badge badge-danger">
                ✕ {stats.cancelledEvents} Cancelled
              </span>
            )}
            <span className="badge badge-secondary">
              🛡️ AI Duplicate Protection Active
            </span>
          </div>
          {stats.lastScanTime && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted, #64748b)' }}>
              🕒 Last Inbox Poller Run: {new Date(stats.lastScanTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* Two Column Grid: Recent Emails & Upcoming Events */}
        <div className="dashboard-grid">
          {/* Recent Processed Emails */}
          <div className="dashboard-card">
            <div className="card-header">
              <div className="card-title">
                <FiMail className="header-icon" />
                <h3>Recent Email Analyses</h3>
              </div>
              <Link to="/emails" className="view-all-link">
                View All <FiExternalLink />
              </Link>
            </div>

            <div className="card-body">
              {loading ? (
                <div className="card-loader"><div className="spinner"></div></div>
              ) : recentEmails.length === 0 ? (
                <div className="empty-state">
                  <FiMail className="empty-icon" />
                  <p>No email threads processed yet.</p>
                  <small>Once emails arrive with meeting info, Gemini AI will analyze them here.</small>
                </div>
              ) : (
                <div className="recent-list">
                  {recentEmails.map((item) => (
                    <div key={item._id} className="recent-item">
                      <div className="item-main">
                        <div className="item-header">
                          <span className="item-title" title={item.threadSnippet || 'Email Thread'}>
                            {item.threadSnippet || 'Email Thread'}
                          </span>
                          <span className={`badge badge-${item.status === 'active' ? 'success' : item.status === 'cancelled' ? 'danger' : 'secondary'}`}>
                            {item.status}
                          </span>
                        </div>
                        {item.linkedEvent && (
                          <div className="item-event-pill" title={item.linkedEvent.title}>
                            <FiCalendar className="pill-icon" />
                            <span className="pill-text">Event: {item.linkedEvent.title || 'Linked'}</span>
                          </div>
                        )}
                        <div className="item-meta">
                          <span>Thread ID: {item.gmailThreadId?.slice(0, 8)}...</span>
                          <span>•</span>
                          <span>{item.messageCount} msg(s)</span>
                          <span>•</span>
                          <span>{new Date(item.lastProcessedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Upcoming Calendar Events */}
          <div className="dashboard-card">
            <div className="card-header">
              <div className="card-title">
                <FiCalendar className="header-icon" />
                <h3>Upcoming Calendar Events</h3>
              </div>
              <Link to="/events" className="view-all-link">
                View All <FiExternalLink />
              </Link>
            </div>

            <div className="card-body">
              {loading ? (
                <div className="card-loader"><div className="spinner"></div></div>
              ) : upcomingEvents.length === 0 ? (
                <div className="empty-state">
                  <FiCalendar className="empty-icon" />
                  <p>No upcoming events created yet.</p>
                  <small>Invitations extracted from your emails will appear here.</small>
                </div>
              ) : (
                <div className="recent-list">
                  {upcomingEvents.map((evt) => (
                    <div key={evt._id} className="recent-item">
                      <div className="item-main">
                        <div className="item-header">
                          <strong className="item-title" title={evt.title}>{evt.title}</strong>
                          <span className={`badge badge-${evt.calendarEventId ? 'success' : 'warning'}`}>
                            {evt.calendarEventId ? 'Synced' : 'Pending'}
                          </span>
                        </div>
                        <div className="item-meta">
                          <span className="meta-time">
                            <FiClock className="meta-icon" />
                            {new Date(evt.startTime).toLocaleDateString([], { month: 'short', day: 'numeric' })} at {new Date(evt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {evt.location && (
                            <span className="meta-location" title={evt.location}>
                              • {evt.location}
                            </span>
                          )}
                        </div>
                      </div>

                      {!evt.calendarEventId && (
                        <button
                          onClick={() => handleAddToCalendar(evt._id)}
                          className="btn btn-sm btn-primary sync-action-btn"
                        >
                          Sync
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Dashboard;
