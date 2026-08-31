import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import GmailAccount from '../models/GmailAccount.js';
import { config } from '../config/index.js';

/**
 * Creates an authenticated calendar client using PRIMARY account tokens.
 * The primary account is the first linked GmailAccount for the user.
 * @param {Object} user - User document (or user with _id)
 * @returns {Promise<import('googleapis').calendar_v3.Calendar>} Calendar API client
 */
export const getCalendarClient = async (user) => {
    const userId = user._id || user;
    const account = await GmailAccount.findOne({ userId, isActive: true }).sort({ linkedAt: 1 });
    if (!account) {
        throw new Error('No linked Gmail account found for calendar access');
    }

    const oauth2Client = new OAuth2Client(
        config.google.clientId,
        config.google.clientSecret
    );
    oauth2Client.setCredentials({
        access_token: account.getDecryptedAccessToken(),
        refresh_token: account.getDecryptedRefreshToken(),
    });
    return google.calendar({ version: 'v3', auth: oauth2Client });
};

/**
 * Fetch the primary calendar timezone for the user
 * @param {import('googleapis').calendar_v3.Calendar} calendar
 * @returns {Promise<string>} Timezone string e.g. 'Asia/Kolkata' or 'UTC'
 */
export const getUserTimeZone = async (calendar) => {
    try {
        const res = await calendar.calendars.get({ calendarId: 'primary' });
        return res.data?.timeZone || 'UTC';
    } catch (err) {
        console.warn('Could not fetch calendar timezone, defaulting to UTC:', err?.message);
        return 'UTC';
    }
};

/**
 * Format date and time to strings suitable for Google Calendar API with timezone support
 * @param {string} [dateStr] - YYYY-MM-DD
 * @param {string|Date} [timeOrDate] - HH:MM, HH:MM:SS or Date object / ISO string
 * @param {string} [timeZone] - User timezone (e.g. 'Asia/Kolkata')
 * @returns {Object} Start/end object for Google Calendar
 */
export const formatEventTime = (dateStr, timeOrDate, timeZone = null) => {
    if (timeOrDate instanceof Date) {
        return { dateTime: isNaN(timeOrDate.getTime()) ? new Date().toISOString() : timeOrDate.toISOString() };
    }
    if (typeof timeOrDate === 'string') {
        const trimmed = timeOrDate.trim();
        // If already a full ISO string with timezone offset or UTC Z
        if (trimmed.includes('T') && (trimmed.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(trimmed))) {
            const parsed = new Date(trimmed);
            if (!isNaN(parsed.getTime())) return { dateTime: parsed.toISOString() };
        }
        
        let baseDate = dateStr;
        if (!baseDate || !/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
            baseDate = new Date().toISOString().split('T')[0];
        }

        const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
        if (match) {
            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const seconds = match[3] ? parseInt(match[3], 10) : 0;
            const ampm = match[4]?.toLowerCase();
            if (ampm === 'pm' && hours < 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;

            const timeFormatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            const localIso = `${baseDate}T${timeFormatted}`;
            return timeZone ? { dateTime: localIso, timeZone } : { dateTime: localIso };
        }

        if (trimmed.includes('T')) {
            return timeZone ? { dateTime: trimmed, timeZone } : { dateTime: trimmed };
        }

        const direct = new Date(`${baseDate}T${trimmed}`);
        if (!isNaN(direct.getTime())) {
            return timeZone ? { dateTime: `${baseDate}T${trimmed}`, timeZone } : { dateTime: direct.toISOString() };
        }
    }
    if (dateStr && !timeOrDate) {
        return { date: dateStr }; // All-day event
    }
    return { dateTime: new Date().toISOString() };
};

/**
 * Creates a Google Calendar event
 * @param {Object} user - User document
 * @param {Object} eventData - { title, description, location, startTime, endTime, date }
 * @returns {Promise<Object>} { id, startDateTime, endDateTime, timeZone }
 */
export const createEvent = async (user, eventData) => {
    const calendar = await getCalendarClient(user);
    const timeZone = await getUserTimeZone(calendar);
    
    let startTime = eventData.startTime;
    let endTime = eventData.endTime;

    // Default endTime to 1 hour after startTime if missing
    if (startTime && !endTime) {
        if (typeof startTime === 'string' && startTime.includes(':') && !startTime.includes('T')) {
            const [hours, mins] = startTime.split(':').map(Number);
            const endHour = (hours + 1) % 24;
            endTime = `${String(endHour).padStart(2, '0')}:${String(mins || 0).padStart(2, '0')}`;
        } else {
            const startDt = new Date(startTime);
            if (!isNaN(startDt.getTime())) {
                endTime = new Date(startDt.getTime() + 60 * 60 * 1000);
            }
        }
    }

    const start = formatEventTime(eventData.date, startTime, timeZone);
    const end = formatEventTime(eventData.date, endTime || startTime, timeZone);

    // Google Calendar API requires start and end to both have dateTime or both have date
    if (start.dateTime && !end.dateTime) {
        end.dateTime = start.dateTime;
        if (timeZone) end.timeZone = timeZone;
        delete end.date;
    } else if (!start.dateTime && end.dateTime) {
        start.dateTime = end.dateTime;
        if (timeZone) start.timeZone = timeZone;
        delete start.date;
    }

    const event = {
        summary: eventData.title,
        location: eventData.location,
        description: eventData.description,
        start,
        end,
        reminders: {
            useDefault: false,
            overrides: [
                { method: 'popup', minutes: 30 },
                { method: 'email', minutes: 30 }
            ]
        }
    };

    try {
        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });
        const created = response.data;
        const result = {
            id: created.id,
            startDateTime: created.start?.dateTime ? new Date(created.start.dateTime) : null,
            endDateTime: created.end?.dateTime ? new Date(created.end.dateTime) : null,
            timeZone: created.start?.timeZone || timeZone,
            toString: () => created.id
        };
        return result;
    } catch (error) {
        console.error('Error creating calendar event:', error);
        throw error;
    }
};

/**
 * Updates an existing calendar event
 * @param {Object} user - User document
 * @param {string} calendarEventId - Google Calendar Event ID
 * @param {Object} eventData - Updated event details
 * @returns {Promise<Object>} Updated event data
 */
export const updateEvent = async (user, calendarEventId, eventData) => {
    const calendar = await getCalendarClient(user);
    const timeZone = await getUserTimeZone(calendar);
    
    let startTime = eventData.startTime;
    let endTime = eventData.endTime;

    if (startTime && !endTime) {
        if (typeof startTime === 'string' && startTime.includes(':') && !startTime.includes('T')) {
            const [hours, mins] = startTime.split(':').map(Number);
            const endHour = (hours + 1) % 24;
            endTime = `${String(endHour).padStart(2, '0')}:${String(mins || 0).padStart(2, '0')}`;
        } else {
            const startDt = new Date(startTime);
            if (!isNaN(startDt.getTime())) {
                endTime = new Date(startDt.getTime() + 60 * 60 * 1000);
            }
        }
    }

    const start = formatEventTime(eventData.date, startTime, timeZone);
    const end = formatEventTime(eventData.date, endTime || startTime, timeZone);

    if (start.dateTime && !end.dateTime) {
        end.dateTime = start.dateTime;
        if (timeZone) end.timeZone = timeZone;
        delete end.date;
    } else if (!start.dateTime && end.dateTime) {
        start.dateTime = end.dateTime;
        if (timeZone) start.timeZone = timeZone;
        delete start.date;
    }

    const event = {
        summary: eventData.title,
        location: eventData.location,
        description: eventData.description,
        start,
        end,
        reminders: {
            useDefault: false,
            overrides: [
                { method: 'popup', minutes: 30 },
                { method: 'email', minutes: 30 }
            ]
        }
    };

    try {
        const response = await calendar.events.update({
            calendarId: 'primary',
            eventId: calendarEventId,
            resource: event,
        });
        const updated = response.data;
        return {
            id: updated.id,
            startDateTime: updated.start?.dateTime ? new Date(updated.start.dateTime) : null,
            endDateTime: updated.end?.dateTime ? new Date(updated.end.dateTime) : null,
            timeZone: updated.start?.timeZone || timeZone,
            data: updated,
            toString: () => updated.id
        };
    } catch (error) {
        console.error(`Error updating calendar event ${calendarEventId}:`, error);
        throw error;
    }
};

/**
 * Deletes a calendar event
 * @param {Object} user - User document
 * @param {string} calendarEventId - Google Calendar Event ID
 * @returns {Promise<void>}
 */
export const deleteEvent = async (user, calendarEventId) => {
    const calendar = await getCalendarClient(user);
    try {
        await calendar.events.delete({
            calendarId: 'primary',
            eventId: calendarEventId,
        });
    } catch (error) {
        console.error(`Error deleting calendar event ${calendarEventId}:`, error);
        throw error;
    }
};

