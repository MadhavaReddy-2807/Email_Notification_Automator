import cron from 'node-cron';
import { getHistoryChanges, getMessage, getThread, parseEmailContent, getGmailClient, getInboxMessages } from './gmailService.js';
import { analyzeEmail, analyzeThread, checkIsDuplicateWithGemini } from './geminiService.js';
import { createEvent, updateEvent, deleteEvent, listCalendarEventsAroundDate } from './calendarService.js';
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
 * @param {boolean} fullInboxScan - If true, scans inbox messages until last checked
 */
export const pollAccount = async (account, fullInboxScan = false) => {
  console.log(`Polling account: ${account.email} (fullScan=${fullInboxScan})`);
  let createdEventsCount = 0;
  try {
    const user = await User.findById(account.userId);
    if (!user) {
      console.warn(`User not found for account ${account.email}`);
      return { createdCount: 0 };
    }

    const gmailClient = getGmailClient(account);
    let messages = [];
    let newHistoryId = null;

    if (fullInboxScan || !account.lastHistoryId) {
      // Scan inbox messages
      messages = await getInboxMessages(account, 30);
    } else {
      const historyRes = await getHistoryChanges(account);
      messages = historyRes.messages || [];
      newHistoryId = historyRes.newHistoryId;

      // If history changes returned 0, double check recent inbox messages
      if (messages.length === 0) {
        const recentInbox = await getInboxMessages(account, 10);
        // Filter for messages not yet processed in ProcessedThread
        for (const inboxMsg of recentInbox) {
          const exists = await ProcessedThread.findOne({
            accountId: account._id,
            lastMessageId: inboxMsg.id
          });
          if (!exists) {
            messages.push(inboxMsg);
          }
        }
      }
    }

    if (!messages || messages.length === 0) {
      console.log(`No new messages for ${account.email}`);
      account.lastPolledAt = new Date();
      if (newHistoryId) account.lastHistoryId = newHistoryId;
      await account.save();
      return { createdCount: 0 };
    }

    console.log(`Processing ${messages.length} messages for ${account.email}`);

    for (const msg of messages) {
      try {
        const threadId = msg.threadId;

        // Check if thread was already processed with this exact message
        const processedThread = await ProcessedThread.findOne({
          gmailThreadId: threadId,
          accountId: account._id
        });

        if (processedThread && processedThread.lastMessageId === msg.id && !fullInboxScan) {
          // Message already analyzed and no full scan requested
          continue;
        }

        // Small rate limit delay between AI calls
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check sender filter if configured
        if (user.settings?.filterSenders?.length > 0) {
          const rawMsg = await getMessage(gmailClient, msg.id);
          const parsed = parseEmailContent(rawMsg);
          const sender = (parsed.from || '').toLowerCase();
          const matchesFilter = user.settings.filterSenders.some(f => sender.includes(f.toLowerCase().trim()));
          if (!matchesFilter) {
            console.log(`Sender "${sender}" not in filter whitelist for ${user.email}, skipping.`);
            continue;
          }
        }

        const existingEvent = processedThread?.linkedEvent
          ? await Event.findById(processedThread.linkedEvent)
          : null;

        let aiResponse;
        let parsedSubject = '';
        if (processedThread) {
          console.log(`[Poller] Thread ${threadId} seen before. Fetching full thread context.`);
          const threadData = await getThread(gmailClient, threadId);
          const parsedMessages = (threadData.messages || []).map(parseEmailContent);
          parsedSubject = parsedMessages[0]?.subject || 'No Subject';
          aiResponse = await analyzeThread(parsedMessages, existingEvent || null);
        } else {
          const messageData = await getMessage(gmailClient, msg.id);
          const parsedMessage = parseEmailContent(messageData);
          parsedSubject = parsedMessage.subject || 'No Subject';
          console.log(`[Poller] Analyzing email: "${parsedSubject}" from "${parsedMessage.from}" (Date: ${parsedMessage.date})`);
          aiResponse = await analyzeEmail(parsedMessage, null);
        }

        const eventsToProcess = (aiResponse.events && aiResponse.events.length > 0)
          ? aiResponse.events
          : (aiResponse.event ? [aiResponse.event] : []);

        console.log(`[Poller] AI Action: ${aiResponse.action} (Confidence: ${aiResponse.confidence}), Extracted Events: ${eventsToProcess.length}`);

        if (aiResponse.confidence < 0.4) {
          console.log(`[Poller] Low confidence (${aiResponse.confidence}) for "${parsedSubject}", skipping.`);
          continue;
        }

        if (aiResponse.action === 'CREATE' && eventsToProcess.length > 0) {
          let lastCreatedEventId = null;

          for (const eventItem of eventsToProcess) {
            const { start: fallbackStart, end: fallbackEnd } = parseEventDates(eventItem);

            // Duplicate Check before adding to Google Calendar
            const checkDate = eventItem.date || fallbackStart.toISOString().split('T')[0];
            const startWindow = new Date(`${checkDate}T00:00:00.000Z`);
            startWindow.setDate(startWindow.getDate() - 1);
            const endWindow = new Date(`${checkDate}T23:59:59.999Z`);
            endWindow.setDate(endWindow.getDate() + 1);

            const existingDbEvents = await Event.find({
              userId: user._id,
              status: { $ne: 'cancelled' },
              startTime: { $gte: startWindow, $lte: endWindow }
            });

            const existingCalEvents = await listCalendarEventsAroundDate(user, checkDate);
            const combinedExisting = [...existingDbEvents, ...existingCalEvents];

            const dupCheck = await checkIsDuplicateWithGemini(eventItem, combinedExisting);
            if (dupCheck.isDuplicate) {
              console.log(`[Poller] Duplicate event detected for "${eventItem.title}" on ${checkDate}: ${dupCheck.reasoning}. Skipping duplicate.`);
              continue;
            }

            let fullDescription = eventItem.description || '';
            if (eventItem.meetingLink && !fullDescription.includes(eventItem.meetingLink)) {
              fullDescription = `🔗 Join Meeting: ${eventItem.meetingLink}\n\n${fullDescription}`;
            }
            if (eventItem.importantNotes && !fullDescription.includes(eventItem.importantNotes)) {
              fullDescription += `\n\n📌 Notes: ${eventItem.importantNotes}`;
            }
            if (eventItem.organizer && !fullDescription.includes(eventItem.organizer)) {
              fullDescription += `\n\n👤 Host: ${eventItem.organizer}`;
            }

            let fullLocation = eventItem.location || '';
            if (eventItem.meetingLink) {
              if (fullLocation && !fullLocation.includes(eventItem.meetingLink)) {
                fullLocation = `${fullLocation} | ${eventItem.meetingLink}`;
              } else {
                fullLocation = eventItem.meetingLink;
              }
            }

            let calendarEventId = null;
            let eventStart = fallbackStart;
            let eventEnd = fallbackEnd;

            // Auto-add to Google Calendar
            if (user.settings?.autoAdd !== false) {
              const calendarResult = await createEvent(user, {
                ...eventItem,
                description: fullDescription.trim(),
                location: fullLocation,
                meetingLink: eventItem.meetingLink,
                date: eventItem.date,
                startTime: eventItem.startTime,
                endTime: eventItem.endTime
              });
              calendarEventId = calendarResult?.id || calendarResult;
              if (calendarResult?.startDateTime) eventStart = calendarResult.startDateTime;
              if (calendarResult?.endDateTime) eventEnd = calendarResult.endDateTime;
            }

            const newEvent = new Event({
              userId: user._id,
              threadId: processedThread?._id,
              calendarEventId: calendarEventId ? String(calendarEventId) : null,
              title: eventItem.title || 'Scheduled Event',
              description: fullDescription.trim(),
              location: fullLocation,
              startTime: eventStart,
              endTime: eventEnd,
              status: 'scheduled',
              history: [{
                action: 'created',
                changedAt: new Date(),
                triggerEmailId: msg.id
              }]
            });
            await newEvent.save();
            lastCreatedEventId = newEvent._id;
            createdEventsCount += 1;

            console.log(`[Poller] Successfully created event "${newEvent.title}" (${calendarEventId}) on ${eventStart}`);
          }

          // Create or update ProcessedThread record
          if (!processedThread) {
            const newThreadRecord = new ProcessedThread({
              userId: user._id,
              accountId: account._id,
              gmailThreadId: threadId,
              lastMessageId: msg.id,
              messageCount: 1,
              linkedEvent: lastCreatedEventId,
              status: 'active',
              threadSnippet: eventsToProcess[0]?.title || parsedSubject || 'Calendar Event'
            });
            await newThreadRecord.save();
          } else {
            processedThread.lastMessageId = msg.id;
            processedThread.lastProcessedAt = new Date();
            if (lastCreatedEventId) processedThread.linkedEvent = lastCreatedEventId;
            await processedThread.save();
          }

        } else if (aiResponse.action === 'RESCHEDULE' && existingEvent && eventsToProcess.length > 0) {
          const eventItem = eventsToProcess[0];
          const { start: fallbackStart, end: fallbackEnd } = parseEventDates(eventItem);
          let eventStart = fallbackStart;
          let eventEnd = fallbackEnd;

          if (existingEvent.calendarEventId) {
            const calendarResult = await updateEvent(user, existingEvent.calendarEventId, {
              ...eventItem,
              date: eventItem.date,
              startTime: eventItem.startTime,
              endTime: eventItem.endTime
            });
            if (calendarResult?.startDateTime) eventStart = calendarResult.startDateTime;
            if (calendarResult?.endDateTime) eventEnd = calendarResult.endDateTime;
          }

          existingEvent.history.push({
            action: 'rescheduled',
            previousStart: existingEvent.startTime,
            previousEnd: existingEvent.endTime,
            changedAt: new Date(),
            triggerEmailId: msg.id
          });
          existingEvent.title = eventItem.title || existingEvent.title;
          existingEvent.startTime = eventStart;
          existingEvent.endTime = eventEnd;
          existingEvent.location = eventItem.location || existingEvent.location;
          existingEvent.status = 'rescheduled';
          await existingEvent.save();

          if (processedThread) {
            processedThread.lastMessageId = msg.id;
            processedThread.messageCount += 1;
            processedThread.lastProcessedAt = new Date();
            await processedThread.save();
          }
          console.log(`[Poller] Rescheduled event ${existingEvent.calendarEventId}`);

        } else if (aiResponse.action === 'CANCEL' && existingEvent) {
          if (existingEvent.calendarEventId) {
            await deleteEvent(user, existingEvent.calendarEventId);
          }

          existingEvent.history.push({
            action: 'cancelled',
            changedAt: new Date(),
            triggerEmailId: msg.id
          });
          existingEvent.status = 'cancelled';
          await existingEvent.save();

          if (processedThread) {
            processedThread.lastMessageId = msg.id;
            processedThread.messageCount += 1;
            processedThread.status = 'cancelled';
            processedThread.lastProcessedAt = new Date();
            await processedThread.save();
          }
          console.log(`[Poller] Cancelled event ${existingEvent.calendarEventId}`);

        } else if (aiResponse.action === 'NO_EVENT') {
          console.log(`[Poller] No event detected for thread ${threadId} ("${parsedSubject}")`);
          if (processedThread) {
            processedThread.lastMessageId = msg.id;
            processedThread.lastProcessedAt = new Date();
            await processedThread.save();
          }
        }
      } catch (err) {
        console.error(`[Poller] Error processing message ${msg.id}:`, err);
      }
    }

    account.lastHistoryId = newHistoryId || account.lastHistoryId;
    account.lastPolledAt = new Date();
    await account.save();
    console.log(`Finished polling ${account.email}. Created ${createdEventsCount} events.`);

    return { createdCount: createdEventsCount };
  } catch (error) {
    console.error(`Error polling account ${account.email}:`, error);
    return { createdCount: 0 };
  }
};

/**
 * Manually scans all active inboxes for a given user
 * @param {string} userId 
 * @returns {Promise<{ success: boolean, createdEvents: number, message: string }>}
 */
export const scanUserInboxes = async (userId) => {
  console.log(`[Manual Scan] Starting inbox scan for user: ${userId}`);
  const accounts = await GmailAccount.find({
    userId,
    isActive: true
  });

  if (!accounts || accounts.length === 0) {
    console.warn(`[Manual Scan] No active Gmail accounts found for user ${userId}`);
    return { success: false, createdEvents: 0, message: 'No active connected Gmail accounts found. Please link an account in the Accounts tab.' };
  }

  let totalCreated = 0;
  for (const account of accounts) {
    const res = await pollAccount(account, true);
    totalCreated += (res?.createdCount || 0);
  }
  return { success: true, createdEvents: totalCreated, message: `Scanned ${accounts.length} account(s). Created ${totalCreated} event(s).` };
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
        await pollAccount(account, false);
      }
    } catch (error) {
      console.error('Error fetching accounts for polling:', error);
    }
  });
};

