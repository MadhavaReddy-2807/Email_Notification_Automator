import passport from 'passport';
import { config } from '../config/index.js';

/**
 * Redirects to Google OAuth with required scopes
 */
export const googleAuth = passport.authenticate('google', {
  scope: [
    'profile',
    'email',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar'
  ],
  accessType: 'offline',
  prompt: 'consent'
});

/**
 * Handle Google OAuth callback
 */
export const googleCallback = (req, res, next) => {
  passport.authenticate('google', {
    failureRedirect: `${config.frontendUrl}/login?error=auth_failed`
  }, (err, user, info) => {
    if (err) {
      console.error('Passport auth error:', err);
      return res.redirect(`${config.frontendUrl}/login?error=auth_error`);
    }
    if (!user) {
      return res.redirect(`${config.frontendUrl}/login?error=auth_failed`);
    }
    
    req.logIn(user, (err) => {
      if (err) {
        console.error('Session login error:', err);
        return res.redirect(`${config.frontendUrl}/login?error=session_error`);
      }
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Session save error:', saveErr);
        }
        res.redirect(`${config.frontendUrl}/`);
      });
    });
  })(req, res, next);
};

/**
 * Returns current authenticated user
 */
export const getMe = (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    res.status(200).json({ success: true, data: req.user });
  } catch (error) {
    console.error('Error in getMe:', error);
    res.status(500).json({ success: false, error: 'Failed to get user data' });
  }
};

/**
 * Logs out the user and destroys the session
 */
export const logout = (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.status(200).json({ success: true, message: 'Logged out successfully' });
    });
  });
};
