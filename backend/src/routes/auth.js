import express from 'express';
import { googleAuth, googleCallback, getMe, logout } from '../controllers/authController.js';
import { ensureAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/google', googleAuth);
router.get('/google/callback', googleCallback);
router.get('/me', ensureAuth, getMe);
router.post('/logout', ensureAuth, logout);

export default router;
