import cron from 'node-cron';
import { getHistoryChanges, getMessage, getThread, parseEmailContent, getGmailClient } from './gmailService.js';
import { analyzeEmail, analyzeThread } from './geminiService.js';
import { createEvent, updateEvent, deleteEvent } from './calendarService.js';
import GmailAccount from '../models/GmailAccount.js';
import User from '../models/User.js';
import ProcessedThread from '../models/ProcessedThread.js';
import Event from '../models/Event.js';

/**
 * Safely parses event date and time strings into guaranteed valid JavaScript Date objects.
 * Handles missing endTime, various time string formats, and defaults cleanly.
 * @param {Object} eventData - { date, startTime, endTime }
 * @returns {{ start: Date, end: Date }}
 */
export const parseEventDates = (eventData = {}) => {
  const { date, startTime, endTime } = eventData;
  const now = new Date();

  // Validate or fallback base date string (YYYY-MM-DD)
  let datePart = date;
  if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    datePart = now.toISOString().split('T')[0];
  }

  const parseTime = (timeStr, defaultHours = 9) => {
    if (!timeStr || typeof timeStr !== 'string') {
      const fallback = new Date(`${datePart}T00:00:00`);
      fallback.setHours(defaultHours, 0, 0, 0);
      return fallback;
    }
    const trimmed = timeStr.trim();

    // Direct ISO / full date-time check
    if (trimmed.includes('T') || trimmed.endsWith('Z')) {
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    // 12-hour or 24-hour time matching (e.g., "14:30", "2:30 PM", "9:00 AM", "18:00:00")
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const ampm = match[4]?.toLowerCase();
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;

      const d = new Date(`${datePart}T00:00:00`);
      d.setHours(hours, minutes, 0, 0);
      if (!isNaN(d.getTime())) return d;
    }

    // Direct string parse with date
    const direct = new Date(`${datePart}T${trimmed}`);
    if (!isNaN(direct.getTime())) return direct;

    const fallback = new Date(`${datePart}T00:00:00`);
    fallback.setHours(defaultHours, 0, 0, 0);
    return fallback;
  };

  const start = parseTime(startTime, 9);
  let end = endTime ? parseTime(endTime, start.getHours() + 1) : null;

  if (!end || isNaN(end.getTime()) || end <= start) {
    end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour duration default
  }

  return { start, end };
};

/**
 * Polls a single Gmail account for changes and processes them
 * @param {Object} account - GmailAccount document to poll
 */
export const pollAccount = async (account) => {
  console.log(`Polling account: ${account.email}`);
  try {
    const user = await User.findById(account.userId);
    if (!user) {
      console.warn(`User not found for account ${account.email}`);
      return;
    }

    const gmailClient = getGmailClient(account);
    const { messages, newHistoryId } = await getHistoryChanges(account);

    if (!messages || messages.length === 0) {
      console.log(`No new messages for ${account.email}`);
      account.lastPolledAt = new Date();
      if (newHistoryId) account.lastHistoryId = newHistoryId;
      await account.save();
      return;
    }

    console.log(`Found ${messages.length} new messages for ${account.email}`);

    for (const msg of messages) {
      try {
        // Small rate limit delay between AI calls
        await new Promise(resolve => setTimeout(resolve, 1500));

        const threadId = msg.threadId;

        // Check sender filter if configured
        if (user.settings?.filterSenders?.length > 0) {
          // Fetch message headers or check sender
          const rawMsg = await getMessage(gmailClient, msg.id);
          const parsed = parseEmailContent(rawMsg);
          const sender = (parsed.from || '').toLowerCase();
          const matchesFilter = user.settings.filterSenders.some(f => sender.includes(f.toLowerCase().trim()));
          if (!matchesFilter) {
            console.log(`Sender "${sender}" not in filter whitelist for ${user.email}, skipping.`);
            continue;
          }
        }

        // Check if we've already processed this thread
        const processedThread = await ProcessedThread.findOne({
          gmailThreadId: threadId,
          accountId: account._id
        });
        const existingEvent = processedThread?.linkedEvent
          ? await Event.findById(processedThread.linkedEvent)
          : null;

        let aiResponse;
        if (processedThread) {
          // Thread seen before — fetch full thread for context
          console.log(`Thread ${threadId} seen before. Fetching full thread context.`);
          const threadData = await getThread(gmailClient, threadId);
          const parsedMessages = threadData.messages.map(parseEmailContent);
          aiResponse = await analyzeThread(parsedMessages, existingEvent || null);
        } else {
          // New thread — analyze single email
          console.log(`New thread ${threadId}. Fetching message.`);
          const messageData = await getMessage(gmailClient, msg.id);
          const parsedMessage = parseEmailContent(messageData);
          aiResponse = await analyzeEmail(parsedMessage, null);
        }

        console.log(`AI Action: ${aiResponse.action} (Confidence: ${aiResponse.confidence})`);

        // Only act if confidence is sufficient
        if (aiResponse.confidence < 0.5) {
          console.log(`Low confidence (${aiResponse.confidence}), skipping action.`);
          continue;
        }

        if (aiResponse.action === 'CREATE' && aiResponse.event) {
          const { start: startDateTime, end: endDateTime } = parseEventDates(aiResponse.event);

          let calendarEventId = null;
          // Auto-add to Google Calendar only if autoAdd setting is not false
          if (user.settings?.autoAdd !== false) {
            calendarEventId = await createEvent(user, {
              ...aiResponse.event,
              startTime: startDateTime.toISOString(),
              endTime: endDateTime.toISOString()
            });
          }

          const newEvent = new Event({
            userId: user._id,
            threadId: processedThread?._id,
            calendarEventId,
            title: aiResponse.event.title || 'Scheduled Event',
            description: aiResponse.event.description || '',
            location: aiResponse.event.location || '',
            startTime: startDateTime,
            endTime: endDateTime,
            status: 'scheduled',
            history: [{
              action: 'created',
              changedAt: new Date(),
              triggerEmailId: msg.id
            }]
          });
          await newEvent.save();

          // Create or update ProcessedThread record
          if (!processedThread) {
            const newThreadRecord = new ProcessedThread({
              userId: user._id,
              accountId: account._id,
              gmailThreadId: threadId,
              lastMessageId: msg.id,
              messageCount: 1,
              linkedEvent: newEvent._id,
              status: 'active',
              threadSnippet: aiResponse.event.title || 'Calendar Event'
            });
            await newThreadRecord.save();
            // Update event with thread reference
            newEvent.threadId = newThreadRecord._id;
            await newEvent.save();
          }

          console.log(`Created event ${calendarEventId} for thread ${threadId}`);

        } else if (aiResponse.action === 'RESCHEDULE' && existingEvent && aiResponse.event) {
          const { start: startDateTime, end: endDateTime } = parseEventDates(aiResponse.event);

          await updateEvent(user, existingEvent.calendarEventId, {
            ...aiResponse.event,
            startTime: startDateTime.toISOString(),
            endTime: endDateTime.toISOString()
          });

          existingEvent.history.push({
            action: 'rescheduled',
            previousStart: existingEvent.startTime,
            previousEnd: existingEvent.endTime,
            changedAt: new Date(),
            triggerEmailId: msg.id
          });
          existingEvent.title = aiResponse.event.title || existingEvent.title;
          existingEvent.startTime = startDateTime;
          existingEvent.endTime = endDateTime;
          existingEvent.location = aiResponse.event.location || existingEvent.location;
          existingEvent.status = 'rescheduled';
          await existingEvent.save();

          processedThread.lastMessageId = msg.id;
          processedThread.messageCount += 1;
          processedThread.lastProcessedAt = new Date();
          await processedThread.save();
          console.log(`Updated event ${existingEvent.calendarEventId}`);

        } else if (aiResponse.action === 'CANCEL' && existingEvent) {
          await deleteEvent(user, existingEvent.calendarEventId);

          existingEvent.history.push({
            action: 'cancelled',
            changedAt: new Date(),
            triggerEmailId: msg.id
          });
          existingEvent.status = 'cancelled';
          await existingEvent.save();

          processedThread.lastMessageId = msg.id;
          processedThread.messageCount += 1;
          processedThread.status = 'cancelled';
          processedThread.lastProcessedAt = new Date();
          await processedThread.save();
          console.log(`Cancelled event ${existingEvent.calendarEventId}`);

        } else if (aiResponse.action === 'NO_EVENT') {
          // Do not write non-event emails to database to save space
          console.log(`No event detected for thread ${threadId} (skipping DB insert)`);
        }
      } catch (err) {
        console.error(`Error processing message ${msg.id}:`, err);
        // Continue with other messages
      }
    }

    account.lastHistoryId = newHistoryId;
    account.lastPolledAt = new Date();
    await account.save();
    console.log(`Finished polling ${account.email}`);

  } catch (error) {
    console.error(`Error polling account ${account.email}:`, error);
  }
};

/**
 * Starts the cron job to poll all active accounts every 2 minutes
 */
export const startPolling = () => {
  console.log('Starting poller service...');
  cron.schedule('*/2 * * * *', async () => {
    console.log('Cron triggered: Polling all active accounts');
    try {
      const accounts = await GmailAccount.find({ isActive: true });
      for (const account of accounts) {
        await pollAccount(account);
      }
    } catch (error) {
      console.error('Error fetching accounts for polling:', error);
    }
  });
};
