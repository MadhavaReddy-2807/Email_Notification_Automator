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
 * @param {Object} [user] - User document
 * @returns {Promise<string>} Timezone string e.g. 'Asia/Kolkata'
 */
export const getUserTimeZone = async (calendar, user = null) => {
    if (user?.settings?.timeZone && user.settings.timeZone !== 'UTC') {
        return user.settings.timeZone;
    }
    try {
        const res = await calendar.calendars.get({ calendarId: 'primary' });
        if (res.data?.timeZone && res.data.timeZone !== 'UTC') {
            return res.data.timeZone;
        }
        const settingRes = await calendar.settings.get({ setting: 'timezone' });
        if (settingRes.data?.value && settingRes.data.value !== 'UTC') {
            return settingRes.data.value;
        }
        return 'Asia/Kolkata';
    } catch (err) {
        return 'Asia/Kolkata';
    }
};

/**
 * Format date and time to strings suitable for Google Calendar API with exact timezone preservation
 * Never appends 'Z' which causes Google Calendar to force UTC conversions.
 * @param {string} [dateStr] - YYYY-MM-DD
 * @param {string|Date} [timeOrDate] - HH:MM, HH:MM:SS or Date object / ISO string
 * @param {string} [timeZone] - User timezone (defaults to 'Asia/Kolkata')
 * @returns {Object} Start/end object for Google Calendar
 */
export const formatEventTime = (dateStr, timeOrDate, timeZone = 'Asia/Kolkata') => {
    const targetZone = (timeZone && timeZone !== 'UTC') ? timeZone : 'Asia/Kolkata';
    let baseDate = dateStr;
    if (!baseDate || !/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
        baseDate = new Date().toISOString().split('T')[0];
    }

    const getOffset = (tz) => {
        if (!tz || tz === 'Asia/Kolkata' || tz === 'IST' || tz === 'UTC') return '+05:30';
        return '+05:30';
    };
    const offsetStr = getOffset(targetZone);

    if (timeOrDate instanceof Date) {
        // Accurately extract local time in targetZone regardless of server timezone
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: targetZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(timeOrDate);
        const getPart = (type) => parts.find(p => p.type === type)?.value || '00';
        const y = getPart('year');
        const m = getPart('month');
        const d = getPart('day');
        let h = getPart('hour');
        if (h === '24') h = '00';
        const min = getPart('minute');
        const s = getPart('second');

        const localIso = `${y}-${m}-${d}T${h}:${min}:${s}${offsetStr}`;
        return { dateTime: localIso, timeZone: targetZone };
    }

    if (typeof timeOrDate === 'string') {
        const trimmed = timeOrDate.trim();

        // 12-hour or 24-hour match (e.g., "16:30", "12:30", "12:30 PM", "12:30pm", "17:45", "4:30 PM", "09:00")
        const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
        if (match) {
            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const seconds = match[3] ? parseInt(match[3], 10) : 0;
            const ampm = match[4]?.toLowerCase();
            if (ampm === 'pm' && hours < 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;

            const timeFormatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            const localIso = `${baseDate}T${timeFormatted}${offsetStr}`;
            return { dateTime: localIso, timeZone: targetZone };
        }

        if (trimmed.includes('T')) {
            const cleanIso = trimmed.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '');
            return { dateTime: `${cleanIso}${offsetStr}`, timeZone: targetZone };
        }

        const localIso = `${baseDate}T${trimmed.padStart(5, '0')}:00${offsetStr}`;
        return { dateTime: localIso, timeZone: targetZone };
    }

    if (dateStr && !timeOrDate) {
        return { date: dateStr }; // All-day event
    }
    return { dateTime: `${baseDate}T09:00:00`, timeZone: targetZone };
};

/**
 * Creates a Google Calendar event
 * @param {Object} user - User document
 * @param {Object} eventData - { title, description, location, startTime, endTime, date }
 * @returns {Promise<Object>} { id, startDateTime, endDateTime, timeZone }
 */
export const createEvent = async (user, eventData) => {
    const calendar = await getCalendarClient(user);
    const timeZone = await getUserTimeZone(calendar, user);
    
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

    // Do not create past / already-completed events in Google Calendar
    if (end.dateTime) {
        const eventEndDate = new Date(end.dateTime);
        if (!isNaN(eventEndDate.getTime()) && eventEndDate < new Date()) {
            console.log(`[CalendarService] Skipping Google Calendar creation for past event "${eventData.title}" (ended at ${eventEndDate.toLocaleString()})`);
            return null;
        }
    } else if (end.date) {
        const todayStr = new Date().toISOString().split('T')[0];
        if (end.date < todayStr) {
            console.log(`[CalendarService] Skipping Google Calendar creation for past all-day event "${eventData.title}" (date: ${end.date})`);
            return null;
        }
    }

    let finalLocation = eventData.location || '';
    if (eventData.meetingLink) {
        if (finalLocation && !finalLocation.includes(eventData.meetingLink)) {
            finalLocation = `${finalLocation} | ${eventData.meetingLink}`;
        } else {
            finalLocation = eventData.meetingLink;
        }
    }

    let fullDescription = eventData.description || '';
    if (eventData.meetingLink && !fullDescription.includes(eventData.meetingLink)) {
        fullDescription = `🔗 Join Meeting: ${eventData.meetingLink}\n\n${fullDescription}`;
    }
    if (eventData.importantNotes && !fullDescription.includes(eventData.importantNotes)) {
        fullDescription += `\n\n📌 Important Notes:\n${eventData.importantNotes}`;
    }
    if (eventData.organizer && !fullDescription.includes(eventData.organizer)) {
        fullDescription += `\n\n👤 Organizer: ${eventData.organizer}`;
    }

    console.log(`\n🗓️ [Google Calendar Insert Payload]`);
    console.log(`   Summary:  "${eventData.title}"`);
    console.log(`   Timezone: "${timeZone}"`);
    console.log(`   Start:    ${JSON.stringify(start)}`);
    console.log(`   End:      ${JSON.stringify(end)}`);
    console.log(`-----------------------------------------------\n`);

    const userEmail = user.email || (user.accounts && user.accounts[0]?.email);

    const event = {
        summary: eventData.title,
        location: finalLocation,
        description: fullDescription.trim(),
        start,
        end,
        ...(userEmail ? {
            attendees: [
                {
                    email: userEmail,
                    displayName: user.name || 'Attendee',
                    responseStatus: 'needsAction' // Prompts the user with Accept / Decline in Google Calendar
                }
            ]
        } : {}),
        reminders: {
            useDefault: false,
            overrides: [
                { method: 'popup', minutes: 10 },
                { method: 'popup', minutes: 30 }
            ]
        }
    };

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            attempts++;
            const response = await calendar.events.insert({
                calendarId: 'primary',
                resource: event,
                sendUpdates: 'all' // Instructs Google Calendar to immediately send the invitation / scheduling notification email
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
            const isNetworkError = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.message?.includes('ECONNRESET');
            if (isNetworkError && attempts < maxAttempts) {
                console.warn(`[CalendarService] Transient network reset (${error.code || 'ECONNRESET'}) on attempt ${attempts}. Retrying in ${attempts * 1.5}s...`);
                await new Promise(r => setTimeout(r, attempts * 1500));
                continue;
            }
            console.error('Error creating calendar event:', error.message || error);
            throw error;
        }
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
    const timeZone = await getUserTimeZone(calendar, user);
    
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

    let finalLocation = eventData.location || '';
    if (eventData.meetingLink) {
        if (finalLocation && !finalLocation.includes(eventData.meetingLink)) {
            finalLocation = `${finalLocation} | ${eventData.meetingLink}`;
        } else {
            finalLocation = eventData.meetingLink;
        }
    }

    let fullDescription = eventData.description || '';
    if (eventData.meetingLink && !fullDescription.includes(eventData.meetingLink)) {
        fullDescription = `🔗 Join Meeting: ${eventData.meetingLink}\n\n${fullDescription}`;
    }
    if (eventData.importantNotes && !fullDescription.includes(eventData.importantNotes)) {
        fullDescription += `\n\n📌 Important Notes:\n${eventData.importantNotes}`;
    }
    if (eventData.organizer && !fullDescription.includes(eventData.organizer)) {
        fullDescription += `\n\n👤 Organizer: ${eventData.organizer}`;
    }

    const event = {
        summary: eventData.title,
        location: finalLocation,
        description: fullDescription.trim(),
        start,
        end,
        reminders: {
            useDefault: false,
            overrides: [
                { method: 'popup', minutes: 10 },
                { method: 'popup', minutes: 30 }
            ]
        }
    };

    try {
        const response = await calendar.events.update({
            calendarId: 'primary',
            eventId: calendarEventId,
            resource: event,
            sendUpdates: 'all'
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
 * List existing Google Calendar events around a given date
 * @param {Object} user
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Promise<Array<Object>>}
 */
export const listCalendarEventsAroundDate = async (user, dateStr) => {
    try {
        const calendar = await getCalendarClient(user);
        let baseDate = dateStr;
        if (!baseDate || !/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
            baseDate = new Date().toISOString().split('T')[0];
        }
        const startOfDay = new Date(`${baseDate}T00:00:00.000Z`);
        const endOfDay = new Date(`${baseDate}T23:59:59.999Z`);

        const res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: startOfDay.toISOString(),
            timeMax: endOfDay.toISOString(),
            singleEvents: true,
            orderBy: 'startTime'
        });
        return res.data?.items || [];
    } catch (err) {
        console.warn('Could not list Google Calendar events around date:', err?.message);
        return [];
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
            sendUpdates: 'all'
        });
    } catch (error) {
        console.error(`Error deleting calendar event ${calendarEventId}:`, error);
        throw error;
    }
};

