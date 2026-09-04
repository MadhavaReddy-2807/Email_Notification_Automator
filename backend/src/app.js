import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import passport from 'passport';

import { config } from './config/index.js';
import { connectDB } from './config/database.js';
import { configurePassport } from './config/passport.js';
import { startPolling } from './services/pollerService.js';

// Route imports
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import emailRoutes from './routes/emails.js';
import eventRoutes from './routes/events.js';
import settingRoutes from './routes/settings.js';

const app = express();

// Trust reverse proxy in production (Render, Heroku, AWS load balancers)
if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
app.use(helmet());
app.use(cors({ 
  origin: [config.frontendUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'].filter(Boolean), 
  credentials: true 
}));
app.use(express.json());
app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.nodeEnv === 'production',
      httpOnly: true,
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    },
  })
);

// Initialize Passport
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/settings', settingRoutes);

// Root endpoint (prevents 404 for uptime monitors pinging root URL)
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Email Notification Automator API is running' });
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start Server
const startServer = async () => {
  // Connect to Database
  await connectDB();

  const server = app.listen(config.port, () => {
    console.log(`Server running in ${config.nodeEnv} mode on port ${config.port}`);
    
    // Start polling service
    console.log('Starting polling service...');
    startPolling();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n⚠️  Port ${config.port} is already in use by another process.`);
      console.error(`👉 Stop the existing process or use a different port in .env.\n`);
    } else {
      console.error('Server error:', err);
    }
  });
};

startServer();
