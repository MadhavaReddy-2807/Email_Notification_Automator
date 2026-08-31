import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true, // Send session cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

// Auth API
export const authApi = {
  getMe: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  getGoogleLoginUrl: () => `${api.defaults.baseURL}/auth/google`,
};

// Accounts API
export const accountsApi = {
  list: () => api.get('/accounts'),
  linkAccount: () => api.post('/accounts/link'),
  unlink: (accountId) => api.delete(`/accounts/${accountId}`),
};

// Emails API
export const emailsApi = {
  list: (params = { page: 1, limit: 10 }) => api.get('/emails', { params }),
  getThread: (threadId) => api.get(`/emails/threads/${threadId}`),
};

// Events API
export const eventsApi = {
  list: (params = { page: 1, limit: 10, status: '' }) => api.get('/events', { params }),
  addToCalendar: (id) => api.post(`/events/${id}/add-to-calendar`),
  update: (id, data) => api.put(`/events/${id}`, data),
  delete: (id) => api.delete(`/events/${id}`),
};


export default api;
