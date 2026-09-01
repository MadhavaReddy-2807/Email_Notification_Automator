# 📚 AutoCal AI: Comprehensive System Architecture & End-to-End Technical Documentation

> **AutoCal AI (Email Notification Automator)** is an autonomous, intelligent multi-account email calendar synchronization and notification platform. It continuously scans connected Gmail inboxes, extracts single or multi-session classes, meetings, webinars, and deadlines using an adaptive Google Gemini & Gemma AI multi-model failover engine, and synchronizes them directly into Google Calendar with exact local timezone preservation, 1-tap meeting join links, mobile push alerts, cross-account deduplication, and automated background cleanup.

---

## 📑 Table of Contents
1. [System Objective & Executive Overview](#1-system-objective--executive-overview)
2. [Complete Architecture & Technology Stack](#2-complete-architecture--technology-stack)
3. [Multi-Account Google OAuth 2.0 & Token Security](#3-multi-account-google-oauth-20--token-security)
4. [AI Deep Parsing Engine & Multi-Model Failover](#4-ai-deep-parsing-engine--multi-model-failover)
5. [Smart Deduplication & Multi-Tier Guards](#5-smart-deduplication--multi-tier-guards)
6. [Timezone & Exact Scheduling Engine (IST Alignment)](#6-timezone--exact-scheduling-engine-ist-alignment)
7. [Background Poller & Multi-Inbox Synchronization](#7-background-poller--multi-inbox-synchronization)
8. [Parallel Background Cleanup & Pruning Engine](#8-parallel-background-cleanup--pruning-engine)
9. [Google Calendar Integration & Mobile Notifications](#9-google-calendar-integration--mobile-notifications)
10. [Frontend Architecture & UI/UX Analytics](#10-frontend-architecture--uiux-analytics)
11. [REST API Reference & Endpoints](#11-rest-api-reference--endpoints)
12. [MongoDB Data Models & Database Schemas](#12-mongodb-data-models--database-schemas)
13. [Production Deployment & Environment Variables](#13-production-deployment--environment-variables)

---

## 1. System Objective & Executive Overview

AutoCal AI resolves the fundamental friction of manual schedule management across university, corporate, and personal email accounts. 

### Key Capabilities:
* **Zero Manual Input**: Automatically monitors incoming emails and schedules meetings, lectures, and webinars directly to Google Calendar.
* **Complex Multi-Event Parsing**: Parses single emails containing weekly recurring lecture schedules (e.g. *Tuesday 9 AM, Wednesday 9 AM, Saturday 10 AM*) into discrete, correctly dated Google Calendar events.
* **Rich Link & Credential Extraction**: Detects Google Meet, Zoom, MS Teams URLs, Meeting IDs, Passcodes, and agendas, placing 1-tap join buttons directly on your calendar event and mobile reminders.
* **Zero 429 Quota Exhaustion**: Employs an intelligent 13-model adaptive failover pool across Google Gemini and Gemma models.
* **Zero Duplicate Calendar Entries**: Protects user calendars using dual-layer AI semantic matching and algorithmic heuristics, including cross-account deduplication when the same email is received on multiple connected accounts.
* **Exact Timezone Preservation**: Eliminates UTC offset shifts by preserving Indian Standard Time (Asia/Kolkata / GMT+5:30) with zero +5:30 distortion.
* **Parallel Lifecycle Cleanup**: Prunes past/expired meetings automatically every 30 minutes in parallel.

---

## 2. Complete Architecture & Technology Stack

`mermaid
flowchart TD
    User(["👤 User"])
    
    subgraph Frontend["Frontend (React + Vite SPA)"]
        Dash["📊 Dashboard (Metrics & Sync Insights)"]
        EventsPage["📅 Calendar Events Table"]
        EmailsPage["📬 Email Intelligence Feed"]
        AccountsPage["🔐 Linked Inboxes Management"]
    end

    subgraph Backend["Backend API (Node.js + Express)"]
        AuthCtrl["🔑 Google OAuth Controller"]
        Poller["⏱️ Poller & Cron Engine (node-cron)"]
        CleanupJob["🧹 Parallel Cleanup Job (30m)"]
        EventCtrl["🎯 Event & Stats Controller"]
    end

    subgraph External["Cloud & External Services"]
        GoogleOAuth["🔐 Google OAuth 2.0 API"]
        GmailAPI["📬 Gmail REST API v1"]
        GoogleCal["📅 Google Calendar API v3"]
        GeminiPool["🧠 Gemini Multi-Model Pool\n(flash-lite, 3.5, 3.1, Gemma)"]
        MongoDB[("💾 MongoDB Atlas (M0 Cluster)")]
    end

    User <-->|HTTPS / Cookies| Frontend
    Frontend <-->|REST API + Credentials| Backend
    Backend <-->|Tokens & Encrypted Keys| GoogleOAuth
    Backend <-->|Message Fetch & Metadata| GmailAPI
    Backend <-->|Schedule & Mobile Reminders| GoogleCal
    Backend <-->|Structured JSON Prompts| GeminiPool
    Backend <-->|Store Users, Threads, Events| MongoDB
`

### Tech Stack Details:
* **Frontend**: React 18, Vite, React Router v6, React Hot Toast, React Icons (eact-icons/fi), Custom Glassmorphism CSS design system.
* **Backend**: Node.js (ESM), Express.js, Passport.js (Google OAuth2 strategy), 
ode-cron, googleapis (Gmail v1 & Calendar v3), @google/generative-ai.
* **Security**: AES-256 token encryption via crypto-js, Helmet security headers, Cross-Origin Cookie Session with SameSite=None, Secure=true, 	rust proxy=1.
* **Database**: MongoDB Atlas M0 Cluster via Mongoose ODM.
* **Deployments**:
  * **Frontend**: Netlify (https://auto-cal.netlify.app) with SPA rewrite rules (_redirects).
  * **Backend**: Render Web Service (https://email-notification-automator.onrender.com).

---

## 3. Multi-Account Google OAuth 2.0 & Token Security

`mermaid
sequenceDiagram
    autonumber
    actor User
    participant Web as AutoCal Frontend
    participant Server as Express Backend
    participant Google as Google OAuth 2.0
    participant DB as MongoDB Atlas

    User->>Web: Clicks "Login with Google"
    Web->>Server: GET /api/auth/google
    Server->>Google: Redirect with scopes (email, profile, gmail.readonly, calendar)
    Google->>User: Consent Screen
    User->>Google: Grants Permissions
    Google->>Server: GET /api/auth/google/callback (Auth Code)
    Server->>Google: Exchange Auth Code for Access & Refresh Tokens
    Server->>Server: Encrypt Tokens (AES-256)
    Server->>DB: Save User & GmailAccount records
    Server->>Web: Set HTTP-Only Session Cookie & Redirect to Dashboard
`

### Multi-Account Linking (/api/accounts/link)
Users can link multiple secondary Gmail accounts (e.g. personal email + university email + work email). The backend separates the primary authentication identity from secondary monitored mailboxes while maintaining independent encrypted token storage per account.

### Automated OAuth Token Refresh Listener
Google access tokens expire every 60 minutes. To prevent 401 Unauthorized errors during background scans:
`javascript
oauth2Client.on('tokens', async (tokens) => {
  if (tokens.refresh_token) account.refreshToken = tokens.refresh_token;
  if (tokens.access_token) account.accessToken = tokens.access_token;
  await account.save(); // Automatically encrypted via Mongoose pre-save hook
});
`

---

## 4. AI Deep Parsing Engine & Multi-Model Failover

To eliminate 429 Too Many Requests quota limitations on free tiers, AutoCal AI utilizes a 13-model hierarchical failover engine.

### Hierarchical Model Pool (geminiService.js)
`javascript
const FALLBACK_MODELS = [
  'gemini-flash-lite-latest',     // High throughput, instant inference
  'gemini-3.5-flash-lite',        // Active quota backup
  'gemini-3.1-flash-lite',        // Active quota backup
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemma-4-31b-it',               // Gemma instruction-tuned model
  'gemma-4-26b-a4b-it',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-flash-latest',
  'gemini-pro-latest',
  'gemini-3.1-pro-preview'
];
`

### Deep Extraction JSON Schema
`json
{
  "action": "CREATE" | "RESCHEDULE" | "CANCEL" | "NO_EVENT",
  "confidence": 0.95,
  "events": [
    {
      "title": "Ubiquitous Computing Class",
      "date": "2026-09-02",
      "startTime": "09:00",
      "endTime": "10:00",
      "location": "LT-31",
      "meetingLink": "https://meet.google.com/xyz-abc-def",
      "description": "📋 Agenda: Sensor Networks\n🔗 Join Link: https://meet.google.com/xyz-abc-def\n👤 Host: Prof. Rao",
      "organizer": "prof.rao@iitbhu.ac.in",
      "importantNotes": "Bring tutorial 2 notes"
    }
  ],
  "reasoning": "The email specifies recurring class sessions with exact times and locations."
}
`

---

## 5. Smart Deduplication & Multi-Tier Guards

### 1. Dual-Layer Duplicate Protection
* **Tier 1 (AI Semantic Evaluation)**: Gemini compares candidate events with existing Google Calendar and MongoDB records around that date to evaluate if they represent the same real-world event.
* **Tier 2 (Algorithmic Fallback)**: If AI quota is exhausted, fuzzy date/title similarity matches the event locally.

### 2. Cross-Account Deduplication
When the user links multiple inboxes and an email is sent or CC'd to multiple linked accounts:
* **Account 1**: Scanned -> Event created on Google Calendar.
* **Account 2**: Scanned -> Duplicate detector notices the event already exists on Google Calendar -> Skips creation -> Logs Duplicate event detected... Skipping duplicate.

### 3. Past & Expired Events Guard
* If an email discusses a meeting or class whose endTime is in the past (endTime < new Date()), the poller automatically skips scheduling to avoid cluttering calendars with expired events.

---

## 6. Timezone & Exact Scheduling Engine (IST Alignment)

### Eliminating the +5:30 UTC Shift
Google Calendar API treats timestamps with trailing **Z** (e.g. 2026-09-01T17:45:00.000Z) as UTC, shifting the event by +5:30 in India.

**Solution (calendarService.js)**:
1. Remove all trailing Z suffixes.
2. Pass explicit local ISO strings with the target timezone:
   `javascript
   {
     dateTime: "2026-09-01T17:45:00",
     timeZone: "Asia/Kolkata"
   }
   `
3. Guarantees **0 UTC offset distortion**: 5:45 PM stays **5:45 PM IST**, 9:00 AM stays **9:00 AM IST**.

---

## 7. Background Poller & Multi-Inbox Synchronization

### Polling Workflow (pollerService.js)
* **Frequency**: Cron triggered every 2 minutes (*/2 * * * *).
* **Rate-Limit Throttling**: 1.0-second polite delay between message inspections.
* **Batch Traversal**: Reads newest messages downwards until reaching previously analyzed message IDs stored in MongoDB (ProcessedThread).
* **Manual On-Demand Scan**: Triggerable from the UI via POST /api/emails/scan.

---

## 8. Parallel Background Cleanup & Pruning Engine

* **Automated Cron**: Executes every 30 minutes (*/30 * * * *) and on server boot.
* **Database Optimization**: Finds all events where endTime < now, deletes them from MongoDB in bulk, and cleans up references in ProcessedThread.
* **On-Demand Pruning**: Users can click **"Prune Past Events"** on the Events page to clean up historical meetings instantly.

---

## 9. Google Calendar Integration & Mobile Notifications

* **Primary Calendar Insertion**: Inserts events directly via Google Calendar API v3.
* **1-Tap Join Buttons**: Formats location as Room / Venue | Meeting Link and prepends join links in the description.
* **Native Mobile Alerts**: Configures Google Calendar mobile pop-up reminders:
  * **Reminder 1**: 30 minutes before start.
  * **Reminder 2**: 10 minutes before start.
* **Live Rescheduling & Cancellation**: Updates or deletes events when meeting updates or cancellation emails are detected.

---

## 10. Frontend Architecture & UI/UX Analytics

`mermaid
graph TD
    App["App.jsx (Router & Auth Context)"]
    App --> Dash["Dashboard.jsx"]
    App --> Events["Events.jsx"]
    App --> Emails["Emails.jsx"]
    App --> Accounts["Accounts.jsx"]

    Dash --> StatCards["📈 Analytics Cards (Emails Scanned, Events Added, Active Inboxes)"]
    Dash --> Insights["🛡️ Sync Insights & AI Duplicate Protection Bar"]
    Dash --> QuickScan["⚡ Scan Inboxes Trigger"]
    Dash --> Recents["📬 Recent Email Intelligence Feed & Upcoming Events"]

    Events --> CleanTable["📅 Clean Event Table (Titles, Dates, Links, Sync Badges)"]
    Events --> PruneBtn["🧹 Prune Past Events Button"]
    Events --> EditModal["✏️ Edit Event Modal"]

    Emails --> IntelligenceFeed["🧠 Thread Feed (Confidence, Reasoning, Extracted Actions)"]
    Accounts --> LinkInbox["🔗 Link Secondary Gmail Inboxes"]
`

---

## 11. REST API Reference & Endpoints

### Authentication (/api/auth)
| Method | Route | Description |
| :--- | :--- | :--- |
| GET | /api/auth/google | Initiates primary Google OAuth 2.0 login |
| GET | /api/auth/google/callback | OAuth redirect callback handler |
| GET | /api/auth/me | Returns authenticated user profile and settings |
| POST | /api/auth/logout | Clears user session and cookies |

### Accounts (/api/accounts)
| Method | Route | Description |
| :--- | :--- | :--- |
| GET | /api/accounts | Lists all linked Gmail inboxes for the user |
| GET | /api/accounts/link | Initiates OAuth flow to link a secondary inbox |
| PATCH | /api/accounts/:id/toggle | Enables / disables monitoring for a specific inbox |
| DELETE | /api/accounts/:id | Unlinks and deletes a Gmail account |

### Emails (/api/emails)
| Method | Route | Description |
| :--- | :--- | :--- |
| GET | /api/emails | Paginated list of processed email threads with AI reasoning |
| POST | /api/emails/scan | Manually triggers deep scan across all user inboxes |

### Events (/api/events)
| Method | Route | Description |
| :--- | :--- | :--- |
| GET | /api/events/stats | Returns real-time email scan and calendar sync metrics |
| GET | /api/events | Paginated list of calendar events (filterable by status) |
| POST | /api/events/cleanup-past | Prunes expired/past meetings from database |
| POST | /api/events/:id/add-to-calendar | Manually syncs pending event to Google Calendar |
| PUT | /api/events/:id | Updates event details and syncs updates to Google Calendar |
| DELETE | /api/events/:id | Cancels event and deletes from Google Calendar |

---

## 12. MongoDB Data Models & Database Schemas

### 1. User.js
`javascript
{
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  googleId: { type: String, required: true, unique: true },
  accounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GmailAccount' }],
  settings: {
    autoAdd: { type: Boolean, default: true },
    timeZone: { type: String, default: 'Asia/Kolkata' },
    monitorLabels: { type: [String], default: ['INBOX'] },
    filterSenders: { type: [String], default: [] }
  }
}
`

### 2. GmailAccount.js
`javascript
{
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  googleId: { type: String, required: true },
  email: { type: String, required: true },
  accessToken: { type: String, required: true },  // AES-256 encrypted
  refreshToken: { type: String, default: '' },    // AES-256 encrypted
  lastHistoryId: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  linkedAt: { type: Date, default: Date.now },
  lastPolledAt: { type: Date }
}
`

### 3. Event.js
`javascript
{
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProcessedThread' },
  calendarEventId: { type: String },
  title: { type: String, required: true },
  description: { type: String },
  location: { type: String },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  status: { type: String, enum: ['scheduled', 'rescheduled', 'cancelled'], default: 'scheduled' },
  history: [{
    action: { type: String, enum: ['created', 'rescheduled', 'cancelled'] },
    changedAt: { type: Date, default: Date.now },
    triggerEmailId: { type: String }
  }]
}
`

### 4. ProcessedThread.js
`javascript
{
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'GmailAccount', required: true },
  gmailThreadId: { type: String, required: true },
  lastMessageId: { type: String },
  messageCount: { type: Number, default: 1 },
  linkedEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
  status: { type: String, enum: ['active', 'cancelled', 'no_event'], default: 'active' },
  threadSnippet: { type: String },
  firstProcessedAt: { type: Date, default: Date.now },
  lastProcessedAt: { type: Date, default: Date.now }
}
`

---

## 13. Production Deployment & Environment Variables

### Backend Configuration (.env)
`env
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://auto-cal.netlify.app
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.mongodb.net/email_automator?retryWrites=true&w=majority
SESSION_SECRET=super_secure_session_secret_key
ENCRYPTION_KEY=super_secure_aes256_encryption_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_CALLBACK_URL=https://email-notification-automator.onrender.com/api/auth/google/callback
GEMINI_API_KEY=your_gemini_api_key
`

### Frontend Configuration (.env)
`env
VITE_API_URL=https://email-notification-automator.onrender.com/api
`

---

*Last Updated: 2026-09-01*
