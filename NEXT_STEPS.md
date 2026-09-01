# 📋 Project Roadmap & Task Tracker

This document tracks completed milestones, ongoing tasks, and upcoming enhancements for the **Email Notification Automator (AutoCal AI)** project.

---

## 🚀 Status Legend
- [x] **Completed & Deployed**
- [ ] **Pending / Upcoming**
- [🔄] **In Progress / Under Verification**

---

## 1. Authentication & Google OAuth
- [x] Google OAuth 2.0 Integration for user authentication (Login with Google)
- [x] Multi-account Gmail connection flow (`/api/accounts/link`)
- [x] Cross-origin session cookie handling for production (Netlify + Render: `SameSite=None`, `Secure=true`, `trust proxy=1`)
- [x] Token encryption and decryption for stored OAuth refresh tokens
- [x] Automatic token refresh listener and database auto-save for expired Google access tokens
- [ ] Add Google account re-authentication prompt if a refresh token is revoked by the user

---

## 2. AI Email Analysis & Event Extraction (Google Gemini)
- [x] Multi-model failover engine (`gemini-3.5-flash` ➔ `gemini-3.6-flash` ➔ `gemini-3.7-flash`) to prevent 429 quota limits
- [x] Timezone alignment (preserving local times and user calendar timezone instead of UTC shift)
- [x] Multi-event extraction support (parsing multiple sessions/classes from a single weekly schedule email)
- [x] AI-powered duplicate event detection + algorithmic fallback (checking candidate events against existing calendar entries)
- [x] Rich extraction of video meeting URLs (Google Meet, Zoom, Teams), passcodes, meeting IDs, agendas, and preparation notes
- [x] Email body fallback to snippet and MIME decoding to handle complex/empty HTML emails
- [ ] Support recurring event rules (RRULE / recurrence in Google Calendar API) for recurring schedules
- [ ] Add attachment parsing (extracting meeting details from `.ics` / calendar invite attachments)

---

## 3. Background Poller & Synchronization
- [x] Cron-based automated polling service (`node-cron` every 2 minutes)
- [x] Inbox scanning from newest downwards until reaching already checked emails
- [x] Manual "Scan Inboxes" on-demand button and endpoint (`POST /api/emails/scan`)
- [x] Tracking processed email threads in MongoDB (`ProcessedThread`) to prevent duplicate AI calls
- [ ] Real-time email webhook notifications via Google Cloud Pub/Sub (Gmail Push Notifications) instead of polling only
- [ ] Rate-limit throttling and queueing system (e.g. BullMQ / Redis) for high email volumes

---

## 4. Google Calendar Management & Notifications
- [x] Auto-adding extracted events to user's primary Google Calendar with 1-tap meeting join links
- [x] Configured native mobile pop-up reminders (10 min & 30 min before events)
- [x] Event updating / rescheduling on thread replies
- [x] Event cancellation synchronization (deleting/cancelling calendar events when cancelled via email)
- [ ] Support selecting a custom / secondary target calendar (instead of only primary)
- [ ] User customizable reminder preferences (e.g. default alert 15m, 1h, or 1 day before)

---

## 5. Frontend & UI/UX (React + Vite)
- [x] Dashboard with live metrics, recent analyses, and upcoming synchronized events
- [x] "Scan Inboxes" trigger buttons on Dashboard, Emails, and Events pages
- [x] Automation Intelligence & Sync Statistics section (showing total emails scanned, events added, and live sync insights)
- [x] Accounts management page (linking secondary inboxes, viewing account status)
- [x] Synchronized events table with manual sync, edit modal, and cancellation options
- [x] Processed email thread intelligence feed
- [ ] User settings modal for adjusting auto-add toggles, sender whitelist, and default reminder times
- [ ] Dark mode / Light mode theme switcher
- [ ] Search and filter bar for events and processed email threads

---

## 6. Production & Deployment
- [x] Netlify deployment for frontend (`https://auto-cal.netlify.app`)
- [x] Render deployment for backend (`https://email-notification-automator.onrender.com`)
- [x] MongoDB Atlas database connection
- [x] GitHub repository synchronization
- [ ] Add automated unit & integration tests (Jest / Vitest for AI parsing & date calculations)
- [ ] Set up continuous integration (GitHub Actions CI/CD)

---

*Last Updated: 2026-09-01*
