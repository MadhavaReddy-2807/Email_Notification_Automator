# Email Notification → Google Calendar Automation

> Automatically monitors Gmail for event-related emails, uses Gemini AI to extract event details, and creates/updates/deletes Google Calendar events.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Setup Guide](#setup-guide)
  - [1. Google Cloud Project](#1-google-cloud-project)
  - [2. Gemini API Key](#2-gemini-api-key)
  - [3. MongoDB Atlas](#3-mongodb-atlas)
  - [4. Environment Variables](#4-environment-variables)
  - [5. Install & Run](#5-install--run)
- [API Reference](#api-reference)
- [How It Works](#how-it-works)
- [Database Models](#database-models)
- [Backend File Map](#backend-file-map)
- [Key Design Decisions](#key-design-decisions)
- [Production Deployment Checklist](PRODUCTION_CHECKLIST.md)
- [Troubleshooting](#troubleshooting)

---

## Tech Stack

| Layer | Technology | Free Tier |
|-------|-----------|-----------|
| **Backend** | Node.js + Express (ES Modules) | Free (local) |
| **Frontend** | React 19 + Vite + React Router + Axios | Free (local) |
| **Email Detection** | Gmail API + Polling (every 2 min) | Free — 1B quota units/day |
| **Event Extraction** | Google Gemini AI (`gemini-2.0-flash`) | Free — 15 RPM, 1M tokens/min |
| **Calendar** | Google Calendar API | Free — 1M queries/day |
| **Database** | MongoDB Atlas (free cluster) | Free — 512 MB storage |
| **Auth** | Google OAuth 2.0 + Passport.js | Free |
| **Token Security** | AES encryption via crypto-js | — |

> **No Pub/Sub. No billing account. 100% free tier.**

---

## Project Structure

```
Email-Notification automation/
├── ARCHITECTURE.md          # Detailed architecture document
├── README.md                # ← You are here
│
├── backend/
│   ├── package.json
│   ├── .env.example         # Copy to .env and fill in
│   │
│   └── src/
│       ├── app.js                        # Express entry point
│       │
│       ├── config/
│       │   ├── index.js                  # Env var loading & validation
│       │   ├── google.js                 # Google OAuth2 client factory
│       │   ├── database.js               # MongoDB connection
│       │   └── passport.js               # Google OAuth strategy
│       │
│       ├── models/
│       │   ├── User.js                   # User schema + settings
│       │   ├── GmailAccount.js           # Linked accounts + encrypted tokens
│       │   ├── ProcessedThread.js        # Tracked email threads
│       │   ├── Event.js                  # Calendar events + history
│       │   └── index.js                  # Barrel export
│       │
│       ├── services/
│       │   ├── gmailService.js           # Gmail API operations
│       │   ├── geminiService.js          # Gemini AI analysis
│       │   ├── calendarService.js        # Google Calendar CRUD
│       │   └── pollerService.js          # Cron-based email poller
│       │
│       ├── controllers/
│       │   ├── authController.js         # OAuth login/logout
│       │   ├── accountController.js      # Link/unlink Gmail accounts
│       │   ├── emailController.js        # List emails & threads
│       │   ├── eventController.js        # Event CRUD + calendar sync
│       │   └── settingsController.js     # User preferences
│       │
│       ├── routes/
│       │   ├── auth.js
│       │   ├── accounts.js
│       │   ├── emails.js
│       │   ├── events.js
│       │   └── settings.js
│       │
│       └── middleware/
│           └── auth.js                   # ensureAuth + ensureLinkedAccount
│
└── frontend/                             # Coming next (React + Vite)
```

---

## Setup Guide

### 1. Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable these APIs (all free):
   - **Gmail API**
   - **Google Calendar API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized redirect URIs:
     ```
     http://localhost:3000/api/auth/google/callback
     http://localhost:3000/api/accounts/link/callback
     ```
5. Copy the **Client ID** and **Client Secret**

### 2. Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Click **Get API Key** → **Create API Key**
3. Copy the key (free tier: 15 requests/minute)

### 3. MongoDB Atlas

1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a free cluster (M0 — 512 MB)
3. Create a database user (username + password)
4. Whitelist your IP (or use `0.0.0.0/0` for development)
5. Click **Connect** → **Connect your application** → Copy the connection string
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/email-automation
   ```

### 4. Environment Variables

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your values:

```env
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/email-automation
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
GEMINI_API_KEY=your_gemini_api_key
SESSION_SECRET=any-random-string-here-make-it-long
ENCRYPTION_KEY=another-random-string-for-token-encryption
FRONTEND_URL=http://localhost:5173
```

### 5. Install & Run

```bash
# Install dependencies (already done)
cd backend
npm install

# Run in development mode (auto-restart on changes)
npm run dev

# Or run in production mode
npm start
```

Server starts at `http://localhost:3000`. The poller begins automatically.

---

## API Reference

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/auth/google` | — | Redirects to Google OAuth |
| `GET` | `/api/auth/google/callback` | — | OAuth callback (redirects to frontend) |
| `GET` | `/api/auth/me` | ✅ | Get current user + accounts |
| `POST` | `/api/auth/logout` | ✅ | Logout, destroy session |

### Accounts
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/accounts` | ✅ | List all linked Gmail accounts |
| `POST` | `/api/accounts/link` | ✅ | Start OAuth to link another Gmail account |
| `GET` | `/api/accounts/link/callback` | ✅ | Link callback (saves account) |
| `DELETE` | `/api/accounts/:accountId` | ✅ | Unlink a Gmail account |

### Emails
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/emails?page=1&limit=10` | ✅ | List processed emails (paginated) |
| `GET` | `/api/emails/threads/:threadId` | ✅ | Get thread details + linked event |

### Events
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/events?page=1&limit=10&status=scheduled` | ✅ | List events (paginated, filterable) |
| `POST` | `/api/events/:id/add-to-calendar` | ✅ | Manually add event to Google Calendar |
| `PUT` | `/api/events/:id` | ✅ | Update event details (syncs to Calendar) |
| `DELETE` | `/api/events/:id` | ✅ | Cancel event (removes from Calendar) |

### Settings
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/settings` | ✅ | Get user settings |
| `PUT` | `/api/settings` | ✅ | Update settings (autoAdd, monitorLabels, filterSenders) |

### Health Check
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Server health check |

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    Every 2 Minutes (Cron)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Poller fetches all active GmailAccounts from MongoDB        │
│                                                                 │
│  2. For each account:                                           │
│     → Call Gmail API history.list (since lastHistoryId)         │
│     → Get new message IDs                                       │
│                                                                 │
│  3. For each new message:                                       │
│     → Check if thread was seen before (ProcessedThread)         │
│                                                                 │
│     IF new thread:                                              │
│       → Fetch single email → Send to Gemini AI                  │
│     IF existing thread:                                         │
│       → Fetch FULL thread → Send to Gemini AI with context      │
│                                                                 │
│  4. Gemini AI returns:                                          │
│     { action: CREATE|RESCHEDULE|CANCEL|NO_EVENT,                │
│       confidence: 0-1, event: {...} }                           │
│                                                                 │
│  5. Based on action:                                            │
│     → CREATE    → Google Calendar: create event                 │
│     → RESCHEDULE → Google Calendar: update event                │
│     → CANCEL    → Google Calendar: delete event                 │
│     → NO_EVENT  → Log and skip                                  │
│                                                                 │
│  6. Save/update ProcessedThread + Event in MongoDB              │
│  7. Update account's lastHistoryId + lastPolledAt               │
└─────────────────────────────────────────────────────────────────┘
```

**Key:** Events always go to the **primary account's** Google Calendar (the account used to log in), regardless of which linked Gmail account received the email.

---

## Database Models

### User
```
email, name, googleId, accounts[], settings { autoAdd, monitorLabels[], filterSenders[] }
```

### GmailAccount
```
userId, googleId, email, accessToken (encrypted), refreshToken (encrypted),
lastHistoryId, isActive, linkedAt, lastPolledAt
```
- Tokens are AES-encrypted at rest using `crypto-js`
- Compound unique index: `userId + email`

### ProcessedThread
```
userId, accountId, gmailThreadId, lastMessageId, messageCount,
linkedEvent, status (active|cancelled|no_event), threadSnippet
```
- Compound unique index: `accountId + gmailThreadId`

### Event
```
userId, threadId, calendarEventId, title, description, location,
startTime, endTime, status (scheduled|rescheduled|cancelled),
history[] { action, previousStart, previousEnd, changedAt, triggerEmailId }
```

---

## Backend File Map

| File | What It Does |
|------|-------------|
| `app.js` | Express server: middleware, routes, starts poller |
| `config/index.js` | Loads `.env`, validates all required vars |
| `config/google.js` | Creates Google OAuth2Client |
| `config/database.js` | Connects to MongoDB with retry logic |
| `config/passport.js` | Google OAuth strategy → finds/creates User + GmailAccount |
| `models/User.js` | User schema with settings |
| `models/GmailAccount.js` | Linked account with encrypted tokens + decrypt methods |
| `models/ProcessedThread.js` | Tracks which email threads have been processed |
| `models/Event.js` | Calendar event data with full change history |
| `services/gmailService.js` | Gmail API: poll history, fetch messages/threads, parse emails |
| `services/geminiService.js` | Sends email/thread to Gemini → gets structured JSON |
| `services/calendarService.js` | Google Calendar CRUD (always uses primary account) |
| `services/pollerService.js` | Cron job: orchestrates the full poll → AI → calendar flow |
| `controllers/authController.js` | OAuth login, callback, logout, getMe |
| `controllers/accountController.js` | Link/unlink additional Gmail accounts |
| `controllers/emailController.js` | List processed emails, get thread details |
| `controllers/eventController.js` | Event CRUD with Google Calendar sync |
| `controllers/settingsController.js` | Read/update user preferences |
| `routes/*.js` | Express routers mapping endpoints → controllers |
| `middleware/auth.js` | Auth guards: `ensureAuth`, `ensureLinkedAccount` |

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Polling over Pub/Sub** | Pub/Sub requires a billing account. Polling every 2 min via `history.list` is free and sufficient for calendar events. |
| **Primary account calendar** | All events go to the login account's calendar, even if the email came from a different linked account. |
| **Token encryption** | OAuth tokens stored AES-encrypted in MongoDB. Decrypted only when making API calls. |
| **Thread-aware AI** | When a thread is seen again, we send the FULL thread + existing event to Gemini so it can detect rescheduling/cancellations in context. |
| **Per-account error isolation** | If one Gmail account fails during polling, others continue unaffected. |
| **Gemini JSON mode** | Using `responseMimeType: "application/json"` for reliable structured output. |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Missing required environment variable` | Check `.env` file exists and all vars are filled |
| `MongoServerError: bad auth` | Verify MongoDB Atlas username/password and IP whitelist |
| `invalid_client` on Google OAuth | Check `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` |
| `403 Forbidden` on Gmail API | Ensure Gmail API is enabled in Google Cloud Console |
| `403 Forbidden` on Calendar API | Ensure Google Calendar API is enabled |
| `Token refresh failed` | User may need to re-authenticate (revoke and re-link) |
| `Gemini rate limit` | Free tier is 15 RPM. Reduce polling frequency or batch |
| Poller not finding messages | Ensure `lastHistoryId` is set (first poll requires a `messages.list` call to bootstrap) |

---

## What's Next

- [x] **Backend** — Express + Mongoose + Gmail + Calendar + Gemini poller
- [x] **Frontend** — React + Vite dashboard with full authentication & management UI
- [ ] **Configure Credentials** — Add Google Client ID/Secret, Gemini API Key, MongoDB URI to `backend/.env`
- [ ] **Run & Test** — Start backend and frontend and test end-to-end flow
