import express from 'express';
import { listAccounts, linkAccount, linkAccountCallback, unlinkAccount } from '../controllers/accountController.js';
import { ensureAuth } from '../middleware/auth.js';

const router = express.Router();
 
// Public callback for Google OAuth link
router.get('/link/callback', linkAccountCallback);

// Protected routes
router.use(ensureAuth);

router.get('/', listAccounts);
router.post('/link', linkAccount);
router.delete('/:accountId', unlinkAccount);

export default router;
