# 🚀 Production Deployment Checklist

This document tracks all changes, configurations, and considerations required when moving **AutoCal AI** from local development (`localhost`) to a live production environment.

---

## 1. Google Cloud Console Configuration

When deploying your app to a live domain (e.g. `https://autocal.yourdomain.com` or `https://yourapp.onrender.com` / `https://yourapp.vercel.app`):

- [ ] **Update Authorized JavaScript Origins**:
  - Add your production frontend URL: `https://your-frontend-domain.com`
- [ ] **Update Authorized Redirect URIs**:
  - Add `https://your-backend-domain.com/api/auth/google/callback`
  - Add `https://your-backend-domain.com/api/accounts/link/callback`
- [ ] **OAuth Consent Screen**:
  - Change status from **Testing** to **In Production** (so any user can log in without being manually added to the test user list).
  - Add official App Name, Support Email, and Developer Contact.
  - (Optional for full verification) Provide Privacy Policy URL & Terms of Service URL to remove the "Google hasn't verified this app" screen.

---

## 2. Backend Environment Variables (`.env`)

Update your production hosting environment (e.g., Render, Railway, AWS, DigitalOcean) with the following:

- [ ] `NODE_ENV`: Set to `production` (enables optimized Express error handling).
- [ ] `PORT`: Use host assigned port (usually provided via `process.env.PORT`).
- [ ] `FRONTEND_URL`: Update from `http://localhost:5173` to `https://your-frontend-domain.com`.
- [ ] `GOOGLE_REDIRECT_URI`: Update from `http://localhost:3000/...` to `https://your-backend-domain.com/api/auth/google/callback`.
- [ ] `MONGODB_URI`: Use a secure production MongoDB Atlas connection string with a dedicated user and strong password.
- [ ] `SESSION_SECRET`: Generate a cryptographically secure 64+ character random string.
- [ ] `ENCRYPTION_KEY`: Generate a unique 32+ character random string for token encryption at rest.
- [ ] `GEMINI_API_KEY`: Add your production Gemini AI API key.

---

## 3. Cookie & Session Security (Production Updates)

When serving over HTTPS in production, update Express session config:

- [ ] In `backend/src/app.js`:
  ```javascript
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Requires HTTPS
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Needed for cross-origin frontend/backend
    maxAge: 7 * 24 * 60 * 60 * 1000,
  }
  ```
- [ ] Enable `app.set('trust proxy', 1);` if your backend is behind a reverse proxy (e.g., Render, Nginx, Cloudflare, Heroku).
- [ ] Ensure CORS `origin` in `backend/src/app.js` is set to `process.env.FRONTEND_URL` and `credentials: true`.

---

## 4. Frontend Configuration

- [ ] Create `frontend/.env.production` with:
  ```env
  VITE_API_URL=https://your-backend-domain.com/api
  ```
- [ ] Build the static assets:
  ```bash
  npm run build
  ```
- [ ] Configure Single Page Application (SPA) routing redirects on hosting provider:
  - For **Vercel**: Add `vercel.json` rewrite (`"source": "/(.*)", "destination": "/index.html"`).
  - For **Netlify**: Add `_redirects` (`/*  /index.html  200`).

---

## 5. Poller & Worker Scaling

- [ ] **Single-Instance Cron**: Ensure `pollerService` runs on only **one** backend instance to avoid duplicate email processing and duplicate Google Calendar event creation.
- [ ] If horizontally scaling backend servers in the future, extract `pollerService.js` into a dedicated background worker worker/cron service or use Redis/MongoDB locks.
- [ ] **Rate Limiting & Retries**: Ensure Gemini API rate limits (15 RPM on free tier) are respected as user count grows.

---

## 6. Security & Monitoring

- [ ] **Database IP Whitelist**: Lock down MongoDB Atlas Network Access to the specific static IP / CIDR block of your backend host instead of `0.0.0.0/0`.
- [ ] **Rate Limiting Middleware**: Add `express-rate-limit` on public routes like `/api/auth/google` to prevent abuse.
- [ ] **Logging & APM**: Connect a logging tool (e.g., Logtail, Winston, or Datadog) to track poller health and AI parsing accuracy.
- [ ] **HTTPS Enforcement**: Ensure all traffic is redirected to HTTPS.
