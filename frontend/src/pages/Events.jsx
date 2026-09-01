import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { eventsApi, emailsApi } from '../services/api';
import { 
  FiCalendar, 
  FiRefreshCw, 
  FiClock, 
  FiMapPin, 
  FiCheckCircle, 
  FiTrash2, 
  FiEdit, 
  FiChevronLeft, 
  FiChevronRight,
  FiPlus,
  FiX
} from 'react-icons/fi';
import toast from 'react-hot-toast';

const Events = () => {
  const [events, setEvents] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    location: '',
    startTime: '',
    endTime: '',
  });

  const fetchEvents = async (page = 1, status = statusFilter) => {
    try {
      setLoading(true);
      const res = await eventsApi.list({ page, limit: 10, status });
      if (res.data?.success) {
        setEvents(res.data.data.events || []);
        setPagination(res.data.data.pagination || { page: 1, limit: 10, total: 0, pages: 1 });
      }
    } catch (err) {
      toast.error('Failed to load calendar events');
    } finally {
      setLoading(false);
    }
  };

  const handleScanInboxes = async () => {
    try {
      setScanning(true);
      toast.loading('Scanning connected inboxes with Gemini AI...', { id: 'scanToast' });
      const res = await emailsApi.scan();
      if (res.data?.success) {
        toast.success(res.data.message || 'Inboxes scanned!', { id: 'scanToast' });
        fetchEvents(1, statusFilter);
      }
    } catch (err) {
      toast.error('Failed to scan inboxes', { id: 'scanToast' });
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchEvents(1, statusFilter);
  }, [statusFilter]);

  const handleSyncToCalendar = async (id) => {
    try {
      const res = await eventsApi.addToCalendar(id);
      if (res.data?.success) {
        toast.success('Successfully added to Google Calendar!');
        fetchEvents(pagination.page);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to sync to Google Calendar');
    }
  };

  const handleUpdateEvent = async (e) => {
    e.preventDefault();
    if (!editingEvent) return;
    try {
      const res = await eventsApi.update(editingEvent._id, editForm);
      if (res.data?.success) {
        toast.success('Event updated successfully');
        setEditingEvent(null);
        fetchEvents(pagination.page);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update event');
    }
  };

  const handleDeleteEvent = async (id) => {
    if (!window.confirm('Are you sure you want to cancel this event? This will also remove it from Google Calendar.')) {
      return;
    }
    try {
      const res = await eventsApi.delete(id);
      if (res.data?.success) {
        toast.success('Event cancelled successfully');
        fetchEvents(pagination.page);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel event');
    }
  };

  const toLocalInputString = (dateObj) => {
    if (!dateObj) return '';
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openEditModal = (event) => {
    setEditingEvent(event);
    setEditForm({
      title: event.title || '',
      description: event.description || '',
      location: event.location || '',
      startTime: toLocalInputString(event.startTime),
      endTime: toLocalInputString(event.endTime),
    });
  };

  return (
    <Layout title="Calendar Events">
      <div className="page-content">
        <div className="page-header-row">
          <div>
            <h2>Scheduled Calendar Events</h2>
            <p>Events discovered and scheduled by AI automation across your inboxes.</p>
          </div>

          <div className="header-filter-group">
            <button 
              className="btn btn-primary btn-icon-text"
              onClick={handleScanInboxes}
              disabled={scanning || loading}
            >
              <FiRefreshCw className={scanning ? 'spin' : ''} />
              <span>{scanning ? 'Scanning...' : 'Scan Inboxes'}</span>
            </button>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="custom-select"
            >
              <option value="">All Statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="rescheduled">Rescheduled</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <button 
              className="btn btn-secondary btn-icon-text"
              onClick={() => fetchEvents(pagination.page)}
              disabled={loading || scanning}
            >
              <FiRefreshCw className={loading ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="table-card">
          <div className="table-responsive">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Event Title</th>
                  <th>Date & Time</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Google Calendar</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="6" className="text-center py-5">
                      <div className="spinner"></div>
                      <p className="mt-2 text-muted">Loading events...</p>
                    </td>
                  </tr>
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-5">
                      <FiCalendar className="empty-table-icon" />
                      <p>No calendar events found.</p>
                      <small className="text-muted">Once emails with meeting invitations are detected, they will appear here.</small>
                    </td>
                  </tr>
                ) : (
                  events.map((evt) => (
                    <tr key={evt._id}>
                      <td>
                        <strong style={{ fontSize: '15px' }}>{evt.title}</strong>
                      </td>
                      <td>
                        <div className="date-time-cell">
                          <FiClock className="mr-1 text-primary" />
                          <span>
                            {new Date(evt.startTime).toLocaleDateString()} {new Date(evt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <small className="text-muted">
                          To: {new Date(evt.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </small>
                      </td>
                      <td>
                        {evt.location ? (
                          <span><FiMapPin className="mr-1 text-danger" />{evt.location}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge badge-${
                          evt.status === 'scheduled' ? 'success' :
                          evt.status === 'rescheduled' ? 'warning' : 'danger'
                        }`}>
                          {evt.status}
                        </span>
                      </td>
                      <td>
                        {evt.calendarEventId ? (
                          <span className="badge badge-success">
                            <FiCheckCircle className="mr-1" /> Synced
                          </span>
                        ) : (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => handleSyncToCalendar(evt._id)}
                          >
                            <FiPlus /> Sync Now
                          </button>
                        )}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => openEditModal(evt)}
                            title="Edit Event"
                          >
                            <FiEdit />
                          </button>
                          {evt.status !== 'cancelled' && (
                            <button
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => handleDeleteEvent(evt._id)}
                              title="Cancel Event"
                            >
                              <FiTrash2 />
                            </button>
                          )}
                        </div>
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
                Showing Page {pagination.page} of {pagination.pages} ({pagination.total} total events)
              </span>
              <div className="pagination-buttons">
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page <= 1}
                  onClick={() => fetchEvents(pagination.page - 1)}
                >
                  <FiChevronLeft /> Previous
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page >= pagination.pages}
                  onClick={() => fetchEvents(pagination.page + 1)}
                >
                  Next <FiChevronRight />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Edit Modal */}
        {editingEvent && (
          <div className="modal-backdrop">
            <div className="custom-modal">
              <div className="modal-header">
                <h3>Edit Event</h3>
                <button className="close-btn" onClick={() => setEditingEvent(null)}>
                  <FiX />
                </button>
              </div>

              <form onSubmit={handleUpdateEvent}>
                <div className="modal-body">
                  <div className="form-group">
                    <label>Event Title</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label>Start Time</label>
                      <input
                        type="datetime-local"
                        className="form-control"
                        value={editForm.startTime}
                        onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>End Time</label>
                      <input
                        type="datetime-local"
                        className="form-control"
                        value={editForm.endTime}
                        onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Location (optional)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editForm.location}
                      onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                      placeholder="e.g. Google Meet, Zoom, Office Room 402"
                    />
                  </div>

                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      rows="3"
                      className="form-control"
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      placeholder="Event details or notes..."
                    />
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setEditingEvent(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Events;
