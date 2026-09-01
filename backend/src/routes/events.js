import express from 'express';
import { listEvents, addToCalendar, updateEvent, deleteEvent, getEventStats } from '../controllers/eventController.js';
import { ensureAuth } from '../middleware/auth.js';

const router = express.Router();

router.use(ensureAuth);

router.get('/stats', getEventStats);
router.get('/', listEvents);
router.post('/:id/add-to-calendar', addToCalendar);
router.put('/:id', updateEvent);
router.delete('/:id', deleteEvent);

export default router;

