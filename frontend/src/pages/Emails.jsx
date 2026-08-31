import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { emailsApi } from '../services/api';
import { 
  FiMail, 
  FiRefreshCw, 
  FiCalendar, 
  FiInfo, 
  FiCheckCircle, 
  FiXCircle, 
  FiChevronLeft, 
  FiChevronRight,
  FiEye,
  FiX
} from 'react-icons/fi';
import toast from 'react-hot-toast';

const Emails = () => {
  const [threads, setThreads] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [selectedThread, setSelectedThread] = useState(null);

  const fetchEmails = async (page = 1) => {
    try {
      setLoading(true);
      const res = await emailsApi.list({ page, limit: 10 });
      if (res.data?.success) {
        setThreads(res.data.data.threads || []);
        setPagination(res.data.data.pagination || { page: 1, limit: 10, total: 0, pages: 1 });
      }
    } catch (err) {
      toast.error('Failed to load email threads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmails(1);
  }, []);

  return (
    <Layout title="Processed Email Threads">
      <div className="page-content">
        <div className="page-header-row">
          <div>
            <h2>Email Intelligence Feed</h2>
            <p>Emails evaluated by Gemini AI for calendar appointments, reschedules, and cancellations.</p>
          </div>
          <button 
            className="btn btn-secondary btn-icon-text"
            onClick={() => fetchEmails(pagination.page)}
            disabled={loading}
          >
            <FiRefreshCw className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="table-card">
          <div className="table-responsive">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Snippet / Subject</th>
                  <th>Gmail Thread ID</th>
                  <th>Messages</th>
                  <th>AI Status</th>
                  <th>Linked Calendar Event</th>
                  <th>Last Processed</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="7" className="text-center py-5">
                      <div className="spinner"></div>
                      <p className="mt-2 text-muted">Analyzing email feed...</p>
                    </td>
                  </tr>
                ) : threads.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="text-center py-5">
                      <FiMail className="empty-table-icon" />
                      <p>No email threads processed yet.</p>
                      <small className="text-muted">The poller runs every 2 minutes and will record messages here.</small>
                    </td>
                  </tr>
                ) : (
                  threads.map((item) => (
                    <tr key={item._id}>
                      <td className="font-weight-bold">
                        {item.threadSnippet || 'No snippet preview available'}
                      </td>
                      <td>
                        <code>{item.gmailThreadId?.slice(0, 12)}...</code>
                      </td>
                      <td>
                        <span className="badge badge-info">{item.messageCount} msg</span>
                      </td>
                      <td>
                        <span className={`badge badge-${
                          item.status === 'active' ? 'success' : 
                          item.status === 'cancelled' ? 'danger' : 'secondary'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td>
                        {item.linkedEvent ? (
                          <span className="text-primary font-weight-medium">
                            <FiCalendar className="mr-1" />
                            {item.linkedEvent.title || 'Event Linked'}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        <small>
                          {new Date(item.lastProcessedAt).toLocaleDateString()} {' '}
                          {new Date(item.lastProcessedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </small>
                      </td>
                      <td>
                        <button 
                          className="btn btn-sm btn-outline"
                          onClick={() => setSelectedThread(item)}
                          title="View Thread Details"
                        >
                          <FiEye />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {pagination.pages > 1 && (
            <div className="pagination-bar">
              <span className="pagination-info">
                Showing Page {pagination.page} of {pagination.pages} ({pagination.total} total items)
              </span>
              <div className="pagination-buttons">
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page <= 1}
                  onClick={() => fetchEmails(pagination.page - 1)}
                >
                  <FiChevronLeft /> Previous
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page >= pagination.pages}
                  onClick={() => fetchEmails(pagination.page + 1)}
                >
                  Next <FiChevronRight />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detail Modal */}
        {selectedThread && (
          <div className="modal-backdrop">
            <div className="custom-modal">
              <div className="modal-header">
                <h3>Thread Details</h3>
                <button className="close-btn" onClick={() => setSelectedThread(null)}>
                  <FiX />
                </button>
              </div>

              <div className="modal-body">
                <div className="detail-group">
                  <label>Snippet</label>
                  <p className="detail-text">{selectedThread.threadSnippet || 'No snippet'}</p>
                </div>

                <div className="detail-grid">
                  <div className="detail-group">
                    <label>Gmail Thread ID</label>
                    <p className="detail-text font-mono">{selectedThread.gmailThreadId}</p>
                  </div>
                  <div className="detail-group">
                    <label>Total Messages</label>
                    <p className="detail-text">{selectedThread.messageCount}</p>
                  </div>
                  <div className="detail-group">
                    <label>Status</label>
                    <p>
                      <span className={`badge badge-${selectedThread.status === 'active' ? 'success' : 'secondary'}`}>
                        {selectedThread.status}
                      </span>
                    </p>
                  </div>
                  <div className="detail-group">
                    <label>First Processed</label>
                    <p className="detail-text">{new Date(selectedThread.firstProcessedAt).toLocaleString()}</p>
                  </div>
                </div>

                {selectedThread.linkedEvent && (
                  <div className="linked-event-card">
                    <h4><FiCalendar /> Associated Calendar Event</h4>
                    <p><strong>Title:</strong> {selectedThread.linkedEvent.title}</p>
                    <p><strong>Status:</strong> {selectedThread.linkedEvent.status}</p>
                    <p><strong>Start:</strong> {new Date(selectedThread.linkedEvent.startTime).toLocaleString()}</p>
                    <p><strong>End:</strong> {new Date(selectedThread.linkedEvent.endTime).toLocaleString()}</p>
                    {selectedThread.linkedEvent.location && (
                      <p><strong>Location:</strong> {selectedThread.linkedEvent.location}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setSelectedThread(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Emails;
