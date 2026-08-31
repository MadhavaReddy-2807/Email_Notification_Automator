import express from 'express';
import { listEmails, getThread } from '../controllers/emailController.js';
import { ensureAuth } from '../middleware/auth.js';

const router = express.Router();

router.use(ensureAuth);

router.get('/', listEmails);
router.get('/threads/:threadId', getThread);

export default router;
