import express from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController.js';
import { ensureAuth } from '../middleware/auth.js';

const router = express.Router();

router.use(ensureAuth);

router.get('/', getSettings);
router.put('/', updateSettings);

export default router;
