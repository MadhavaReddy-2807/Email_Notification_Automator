import Event from '../models/Event.js';
import User from '../models/User.js';
import ProcessedThread from '../models/ProcessedThread.js';
import GmailAccount from '../models/GmailAccount.js';
import * as calendarService from '../services/calendarService.js';

/**
 * Get comprehensive statistics for emails scanned and events added
 */
export const getEventStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const [
      totalEvents,
      syncedEvents,
      rescheduledEvents,
      cancelledEvents,
      threads,
      accounts
    ] = await Promise.all([
      Event.countDocuments({ userId }),
      Event.countDocuments({ userId, calendarEventId: { $exists: true, $ne: null } }),
      Event.countDocuments({ userId, status: 'rescheduled' }),
      Event.countDocuments({ userId, status: 'cancelled' }),
      ProcessedThread.find({ userId }),
      GmailAccount.find({ userId, isActive: true })
    ]);

    const totalThreads = threads.length;
    const totalEmailsScanned = threads.reduce((acc, t) => acc + (t.messageCount || 1), 0);
    const lastScanTime = accounts.reduce((latest, acc) => {
      if (!acc.lastPolledAt) return latest;
      return !latest || acc.lastPolledAt > latest ? acc.lastPolledAt : latest;
    }, null);

    res.status(200).json({
      success: true,
      data: {
        totalEmailsScanned,
        totalThreads,
        totalEvents,
        syncedEvents,
        rescheduledEvents,
        cancelledEvents,
        activeAccounts: accounts.length,
        lastScanTime
      }
    });
  } catch (error) {
    console.error('Error in getEventStats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
};


/**
 * List events for the current user with pagination and optional status filter
 */
export const listEvents = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { userId: req.user._id };
    if (req.query.status) {
      query.status = req.query.status;
    }

    const events = await Event.find(query)
      .sort({ startTime: 1 })
      .skip(skip)
      .limit(limit)
      .populate('threadId');

    const total = await Event.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        events,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit) || 1
        }
      }
    });
  } catch (error) {
    console.error('Error in listEvents:', error);
    res.status(500).json({ success: false, error: 'Failed to list events' });
  }
};

/**
 * Manually add an event to Google Calendar (for events awaiting approval)
 */
export const addToCalendar = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findOne({ _id: id, userId: req.user._id });

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    if (event.calendarEventId) {
      return res.status(400).json({ success: false, error: 'Event already added to calendar' });
    }

    const calendarEventId = await calendarService.createEvent(req.user, {
      title: event.title,
      description: event.description,
      location: event.location,
      startTime: event.startTime,
      endTime: event.endTime
    });

    event.calendarEventId = calendarEventId;
    event.history.push({
      action: 'created',
      changedAt: new Date(),
      triggerEmailId: 'manual'
    });

    await event.save();
    res.status(200).json({ success: true, data: event });
  } catch (error) {
    console.error('Error in addToCalendar:', error);
    res.status(500).json({ success: false, error: 'Failed to add event to calendar' });
  }
};

/**
 * Update event details. If synced to Google Calendar, updates there too
 */
export const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, location, startTime, endTime } = req.body;

    const event = await Event.findOne({ _id: id, userId: req.user._id });

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Record previous state in history
    event.history.push({
      action: 'rescheduled',
      previousStart: event.startTime,
      previousEnd: event.endTime,
      changedAt: new Date(),
      triggerEmailId: 'manual'
    });

    // Apply updates
    if (title) event.title = title;
    if (description !== undefined) event.description = description;
    if (location !== undefined) event.location = location;
    if (startTime) event.startTime = new Date(startTime);
    if (endTime) event.endTime = new Date(endTime);
    event.status = 'rescheduled';

    // Sync to Google Calendar if linked
    if (event.calendarEventId) {
      await calendarService.updateEvent(req.user, event.calendarEventId, {
        title: event.title,
        description: event.description,
        location: event.location,
        startTime: event.startTime,
        endTime: event.endTime
      });
    }

    await event.save();
    res.status(200).json({ success: true, data: event });
  } catch (error) {
    console.error('Error in updateEvent:', error);
    res.status(500).json({ success: false, error: 'Failed to update event' });
  }
};

/**
 * Cancel/delete an event. Removes from Google Calendar if synced
 */
export const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findOne({ _id: id, userId: req.user._id });

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }

    // Delete from Google Calendar if synced
    if (event.calendarEventId) {
      await calendarService.deleteEvent(req.user, event.calendarEventId);
    }

    event.status = 'cancelled';
    event.history.push({
      action: 'cancelled',
      changedAt: new Date(),
      triggerEmailId: 'manual'
    });

    await event.save();
    res.status(200).json({ success: true, message: 'Event cancelled successfully', data: event });
  } catch (error) {
    console.error('Error in deleteEvent:', error);
    res.status(500).json({ success: false, error: 'Failed to delete event' });
  }
};

/**
 * Prunes past events that have already ended for the current user
 */
export const cleanupPastEventsController = async (req, res) => {
  try {
    const daysOld = parseInt(req.query.daysOld) || 0;
    const { cleanupPastEvents } = await import('../services/pollerService.js');
    const result = await cleanupPastEvents(req.user._id, daysOld);
    res.status(200).json({
      success: true,
      message: `Cleaned up ${result.deletedCount} past event(s) from database`,
      data: result
    });
  } catch (error) {
    console.error('Error in cleanupPastEventsController:', error);
    res.status(500).json({ success: false, error: 'Failed to clean up past events' });
  }
};
