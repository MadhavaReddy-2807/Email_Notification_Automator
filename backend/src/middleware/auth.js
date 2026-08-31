/**
 * Middleware to ensure the user is authenticated via Passport.
 */
export const ensureAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ success: false, error: 'Unauthorized: User not authenticated' });
};

/**
 * Middleware to ensure the authenticated user has at least one linked Gmail account.
 */
export const ensureLinkedAccount = (req, res, next) => {
  if (req.user && req.user.accounts && req.user.accounts.length > 0) {
    return next();
  }
  res.status(403).json({ success: false, error: 'Forbidden: No linked Google account found' });
};
