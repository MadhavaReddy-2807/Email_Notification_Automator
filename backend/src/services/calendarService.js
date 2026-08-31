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
 * Format date and time to ISO strings suitable for Google Calendar API
 * @param {string} [dateStr] - YYYY-MM-DD
 * @param {string|Date} [timeOrDate] - HH:MM, HH:MM:SS or Date object / ISO string
 * @returns {Object} Start/end object for Google Calendar
 */
const formatEventTime = (dateStr, timeOrDate) => {
    if (timeOrDate instanceof Date) {
        return { dateTime: isNaN(timeOrDate.getTime()) ? new Date().toISOString() : timeOrDate.toISOString() };
    }
    if (typeof timeOrDate === 'string') {
        const trimmed = timeOrDate.trim();
        if (trimmed.includes('T') || trimmed.endsWith('Z')) {
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
            const ampm = match[4]?.toLowerCase();
            if (ampm === 'pm' && hours < 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;

            const d = new Date(`${baseDate}T00:00:00`);
            d.setHours(hours, minutes, 0, 0);
            if (!isNaN(d.getTime())) return { dateTime: d.toISOString() };
        }

        const direct = new Date(`${baseDate}T${trimmed}`);
        if (!isNaN(direct.getTime())) return { dateTime: direct.toISOString() };
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
 * @returns {Promise<string>} calendarEventId
 */
export const createEvent = async (user, eventData) => {
    const calendar = await getCalendarClient(user);
    
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

    const start = formatEventTime(eventData.date, startTime);
    const end = formatEventTime(eventData.date, endTime || startTime);

    // Google Calendar API requires start and end to both have dateTime or both have date
    if (start.dateTime && !end.dateTime) {
        end.dateTime = new Date(new Date(start.dateTime).getTime() + 60 * 60 * 1000).toISOString();
        delete end.date;
    } else if (!start.dateTime && end.dateTime) {
        start.dateTime = new Date(new Date(end.dateTime).getTime() - 60 * 60 * 1000).toISOString();
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
        return response.data.id;
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

    const start = formatEventTime(eventData.date, startTime);
    const end = formatEventTime(eventData.date, endTime || startTime);

    if (start.dateTime && !end.dateTime) {
        end.dateTime = new Date(new Date(start.dateTime).getTime() + 60 * 60 * 1000).toISOString();
        delete end.date;
    } else if (!start.dateTime && end.dateTime) {
        start.dateTime = new Date(new Date(end.dateTime).getTime() - 60 * 60 * 1000).toISOString();
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
        return response.data;
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
