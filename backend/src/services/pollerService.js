import cron from 'node-cron';
import { getHistoryChanges, getMessage, getThread, parseEmailContent, getGmailClient, getInboxMessages } from './gmailService.js';
import { analyzeEmail, analyzeThread, checkIsDuplicateWithGemini } from './geminiService.js';
import { createEvent, updateEvent, deleteEvent, listCalendarEventsAroundDate } from './calendarService.js';
import GmailAccount from '../models/GmailAccount.js';
import User from '../models/User.js';
import ProcessedThread from '../models/ProcessedThread.js';
import Event from '../models/Event.js';


/**
 * Helper to construct a Date object from a local date/time string in a specific timezone
 * @param {string} localIsoString - e.g. "2026-09-01T12:30:00"
 * @param {string} timeZone - e.g. "Asia/Kolkata"
 * @returns {Date}
 */
export const createDateInTimezone = (localIsoString, timeZone = 'Asia/Kolkata') => {
  const clean = localIsoString.replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '');
  if (!timeZone || timeZone === 'Asia/Kolkata' || timeZone === 'IST') {
    return new Date(`${clean}+05:30`);
  }
  try {
    const tempDate = new Date(`${clean}Z`);
    const invDate = new Date(tempDate.toLocaleString('en-US', { timeZone }));
    const diff = tempDate.getTime() - invDate.getTime();
    return new Date(tempDate.getTime() + diff);
  } catch (e) {
    return new Date(`${clean}+05:30`);
  }
};

/**
 * Safely parses event date and time strings into guaranteed valid JavaScript Date objects
 * aligned with the target timezone (defaults to Asia/Kolkata).
 * @param {Object} eventData - { date, startTime, endTime }
 * @param {string} [timeZone] - e.g. 'Asia/Kolkata'
 * @returns {{ start: Date, end: Date }}
 */
export const parseEventDates = (eventData = {}, timeZone = 'Asia/Kolkata') => {
  const { date, startTime, endTime } = eventData;
  const now = new Date();

  // Validate or fallback base date string (YYYY-MM-DD)
  let datePart = date;
  if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    datePart = now.toISOString().split('T')[0];
  }

  const parseTimeToDate = (timeStr, defaultHours = 9) => {
    if (!timeStr || typeof timeStr !== 'string') {
      const formatted = `${datePart}T${String(defaultHours).padStart(2, '0')}:00:00`;
      return createDateInTimezone(formatted, timeZone);
    }
    const trimmed = timeStr.trim();

    // 12-hour or 24-hour time matching (e.g., "12:30", "12:30 PM", "12:30pm", "14:30", "2:30 PM", "9:00 AM", "18:00:00")
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = match[3] ? parseInt(match[3], 10) : 0;
      const ampm = match[4]?.toLowerCase();
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;

      const formatted = `${datePart}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      return createDateInTimezone(formatted, timeZone);
    }

    // Direct ISO / full date-time check
    if (trimmed.includes('T') || trimmed.endsWith('Z')) {
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    return createDateInTimezone(`${datePart}T${String(defaultHours).padStart(2, '0')}:00:00`, timeZone);
  };

  const start = parseTimeToDate(startTime, 9);
  let end = endTime ? parseTimeToDate(endTime, 10) : null;

  if (!end || isNaN(end.getTime()) || end <= start) {
    end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour duration default
  }

  return { start, end };
};

/**
 * Fast Pre-AI Heuristic Filter
 * Filters out obvious non-event emails (OTPs, promotional spam, newsletters, delivery updates)
 * before making Gemini API calls, saving 70-80% of quota.
 * @param {Object} emailContent - { subject, from, body }
 * @returns {{ shouldSkip: boolean, reason: string }}
 */
export const evaluatePreAiFilter = (emailContent = {}) => {
  const subject = (emailContent.subject || '').toLowerCase().trim();
  const from = (emailContent.from || '').toLowerCase().trim();
  const body = (emailContent.body || '').toLowerCase().trim();

  // 1. Positive Signal Override: If strong meeting/event markers exist, NEVER skip!
  const hasStrongEventMarkers = 
    body.includes('meet.google.com') ||
    body.includes('zoom.us/j') ||
    body.includes('teams.microsoft.com') ||
    body.includes('webex.com') ||
    body.includes('meeting id:') ||
    body.includes('passcode:') ||
    subject.includes('invitation:') ||
    subject.includes('interview') ||
    subject.includes('webinar') ||
    subject.includes('class schedule') ||
    subject.includes('symposium') ||
    subject.includes('lecture') ||
    subject.includes('timetable');

  if (hasStrongEventMarkers) {
    return { shouldSkip: false, reason: 'Strong event markers detected' };
  }

  // 2. High-Confidence Non-Event Subject Patterns (OTPs, Security, Orders, Bills)
  const nonEventSubjectPatterns = [
    /\b(otp|one time password|verification code|security code)\b/i,
    /\b(password reset|reset your password|verify your email|email verification)\b/i,
    /\b(new sign-in|security alert|login attempt|account access)\b/i,
    /\b(order confirmed|order placed|order shipped|out for delivery|delivered)\b/i,
    /\b(payment received|payment receipt|invoice for|statement of account|billing receipt)\b/i,
    /\b(your subscription|subscription renewed|recharge successful)\b/i,
    /\b(\d+%\s*off|sale is live|exclusive offer|mega sale|discount inside|flash sale)\b/i,
    /\b(liked your|started following|endorsed you for|weekly digest|daily digest)\b/i
  ];

  for (const pattern of nonEventSubjectPatterns) {
    if (pattern.test(subject)) {
      return { shouldSkip: true, reason: `Subject matches non-event pattern: ${pattern}` };
    }
  }

  // 3. Known Automated/Transactional/Social Senders without event content
  const promotionalSenders = [
    'marketing@', 'promotions@', 'newsletter@', 'newsletters@', 'digest@',
    'no-reply@accounts.google.com', 'account-security-noreply@',
    'orders@', 'shipping@', 'delivery@', 'billing@', 'payments@',
    'swiggy.in', 'zomato.com', 'uber.com', 'ola.com', 'amazon.in', 'amazon.com',
    'flipkart.com', 'myntra.com', 'netflix.com', 'spotify.com',
    'mail.instagram.com', 'instagram.com', 'linkedin.com', 'facebookmail.com', 'x.com', 'twitter.com'
  ];

  const isPromoSender = promotionalSenders.some(s => from.includes(s));
  if (isPromoSender) {
    return { shouldSkip: true, reason: `Sender (${from}) is a known promotional/transactional service` };
  }

  // 4. Quick Date/Time Presence Check
  // If subject and body contain zero time/date indicators (e.g. AM, PM, hours, weekdays, months), skip.
  const hasTimeOrDate = 
    /\b(am|pm|hrs|hours|o'clock|\d{1,2}:\d{2})\b/i.test(subject + ' ' + body) ||
    /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(subject + ' ' + body) ||
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(subject + ' ' + body);

  if (!hasTimeOrDate) {
    return { shouldSkip: true, reason: 'No temporal or time markers found in subject or body' };
  }

  return { shouldSkip: false, reason: 'Potential event email passed to AI' };
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

        const existingEvent = processedThread?.linkedEvent
          ? await Event.findById(processedThread.linkedEvent)
          : null;

        let parsedSubject = '';
        let latestParsedMessage = null;
        let parsedMessages = [];

        if (processedThread) {
          const threadData = await getThread(gmailClient, threadId);
          parsedMessages = (threadData.messages || []).map(parseEmailContent);
          latestParsedMessage = parsedMessages[parsedMessages.length - 1] || parsedMessages[0] || {};
          parsedSubject = parsedMessages[0]?.subject || 'No Subject';
        } else {
          const messageData = await getMessage(gmailClient, msg.id);
          latestParsedMessage = parseEmailContent(messageData);
          parsedSubject = latestParsedMessage.subject || 'No Subject';
        }

        // Check sender filter if configured
        if (user.settings?.filterSenders?.length > 0) {
          const sender = (latestParsedMessage.from || '').toLowerCase();
          const matchesFilter = user.settings.filterSenders.some(f => sender.includes(f.toLowerCase().trim()));
          if (!matchesFilter) {
            console.log(`Sender "${sender}" not in filter whitelist for ${user.email}, skipping.`);
            continue;
          }
        }

        // Fast Pre-AI Heuristic Filter (skips OTPs, newsletters, receipts, promo emails before calling Gemini)
        const preAiCheck = evaluatePreAiFilter(latestParsedMessage);
        if (preAiCheck.shouldSkip) {
          console.log(`[Pre-AI Filter ⚡] Skipped non-event email "${parsedSubject}" from "${latestParsedMessage.from}": ${preAiCheck.reason}`);
          if (!processedThread) {
            const newThreadRecord = new ProcessedThread({
              userId: user._id,
              accountId: account._id,
              gmailThreadId: threadId,
              lastMessageId: msg.id,
              messageCount: 1,
              status: 'no_event',
              threadSnippet: parsedSubject || 'Filtered Non-Event'
            });
            await newThreadRecord.save();
          } else {
            processedThread.lastMessageId = msg.id;
            processedThread.lastProcessedAt = new Date();
            await processedThread.save();
          }
          continue; // Bypasses expensive Gemini API call
        }

        // Throttle delay between AI calls to stay under Google Free Tier 15 RPM limit
        await new Promise(resolve => setTimeout(resolve, 2500));

        let aiResponse;
        if (processedThread) {
          console.log(`[Poller] Thread ${threadId} seen before & passed filter. Fetching full AI analysis...`);
          aiResponse = await analyzeThread(parsedMessages, existingEvent || null);
        } else {
          console.log(`[Poller] Analyzing email: "${parsedSubject}" from "${latestParsedMessage.from}" (Date: ${latestParsedMessage.date}) with AI...`);
          aiResponse = await analyzeEmail(latestParsedMessage, null);
        }

        const eventsToProcess = (aiResponse.events && aiResponse.events.length > 0)
          ? aiResponse.events
          : (aiResponse.event ? [aiResponse.event] : []);

        console.log(`[Poller] AI Action: ${aiResponse.action} (Confidence: ${aiResponse.confidence}), Extracted Events: ${eventsToProcess.length}`);

        if (aiResponse.confidence < 0.4) {
          console.log(`[Poller] Low confidence (${aiResponse.confidence}) for "${parsedSubject}", skipping.`);
          continue;
        }

        const userTimeZone = user.settings?.timeZone || 'Asia/Kolkata';

        if (aiResponse.action === 'CREATE' && eventsToProcess.length > 0) {
          let lastCreatedEventId = null;

          for (const eventItem of eventsToProcess) {
            const { start: fallbackStart, end: fallbackEnd } = parseEventDates(eventItem, userTimeZone);

            // Guard: Skip events that have already ended/completed in the past
            const now = new Date();
            if (fallbackEnd < now) {
              console.log(`[Poller] Skipping already-completed past event "${eventItem.title}" on ${eventItem.date || checkDate || 'past date'} (ended at ${fallbackEnd.toLocaleTimeString()}).`);
              continue;
            }

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

        } else if (aiResponse.action === 'RESCHEDULE' && eventsToProcess.length > 0) {
          const eventItem = eventsToProcess[0];
          const { start: fallbackStart, end: fallbackEnd } = parseEventDates(eventItem, userTimeZone);
          let eventStart = fallbackStart;
          let eventEnd = fallbackEnd;

          if (existingEvent) {
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
          } else {
            // No existing event in DB for this thread yet - treat the rescheduled details as a new event
            let calendarEventId = null;
            if (user.settings?.autoAdd !== false) {
              const calendarResult = await createEvent(user, {
                ...eventItem,
                description: (eventItem.description || '').trim(),
                location: eventItem.location || '',
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
              title: eventItem.title || 'Rescheduled Event',
              description: eventItem.description || '',
              location: eventItem.location || '',
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

            if (!processedThread) {
              const newThreadRecord = new ProcessedThread({
                userId: user._id,
                accountId: account._id,
                gmailThreadId: threadId,
                lastMessageId: msg.id,
                messageCount: 1,
                linkedEvent: newEvent._id,
                status: 'active',
                threadSnippet: eventItem.title || parsedSubject || 'Rescheduled Event'
              });
              await newThreadRecord.save();
            } else {
              processedThread.lastMessageId = msg.id;
              processedThread.lastProcessedAt = new Date();
              processedThread.linkedEvent = newEvent._id;
              await processedThread.save();
            }
            console.log(`[Poller] Created new event from RESCHEDULE action: "${newEvent.title}"`);
          }

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

        } else {
          // NO_EVENT or unhandled action - save thread to prevent repeated AI processing
          console.log(`[Poller] No event to create for thread ${threadId} ("${parsedSubject}")`);
          if (!processedThread) {
            const newThreadRecord = new ProcessedThread({
              userId: user._id,
              accountId: account._id,
              gmailThreadId: threadId,
              lastMessageId: msg.id,
              messageCount: 1,
              status: 'no_event',
              threadSnippet: parsedSubject || 'No Event'
            });
            await newThreadRecord.save();
          } else {
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
 * Automatically prunes past/expired meetings from the database.
 * Runs in parallel to keep MongoDB lean, fast, and free of old clutter.
 * @param {string|null} userId - Specific user or null for global cleanup
 * @param {number} daysOld - Events ended before this many days (default: 0 = already ended)
 */
export const cleanupPastEvents = async (userId = null, daysOld = 0) => {
  try {
    const thresholdDate = new Date();
    if (daysOld > 0) {
      thresholdDate.setDate(thresholdDate.getDate() - daysOld);
    }

    const query = { endTime: { $lt: thresholdDate } };
    if (userId) query.userId = userId;

    const pastEvents = await Event.find(query).select('_id');
    if (pastEvents.length === 0) {
      return { deletedCount: 0 };
    }

    const eventIds = pastEvents.map(e => e._id);
    const result = await Event.deleteMany({ _id: { $in: eventIds } });

    // Unlink deleted events from processed threads
    await ProcessedThread.updateMany(
      { linkedEvent: { $in: eventIds } },
      { $unset: { linkedEvent: 1 } }
    );

    console.log(`[Cleanup Job] Pruned ${result.deletedCount} past event(s) ended before ${thresholdDate.toLocaleTimeString()}`);
    return { deletedCount: result.deletedCount };
  } catch (error) {
    console.error('[Cleanup Job] Error pruning past events:', error);
    return { deletedCount: 0, error: error.message };
  }
};

/**
 * Starts the cron jobs:
 * 1. Polls all active accounts every 2 minutes for new incoming emails.
 * 2. Auto-clean past events once a day at midnight (00:00).
 */
export const startPolling = () => {
  console.log('Starting poller & background services...');

  // Cron 1: Poll inboxes for new emails every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    console.log('Cron triggered: Polling all active Gmail accounts for new emails...');
    try {
      const accounts = await GmailAccount.find({ isActive: true });
      for (const account of accounts) {
        await pollAccount(account, false);
        // Stagger accounts with 2s pause to spread requests evenly across the 2-minute cycle
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (error) {
      console.error('Error fetching accounts for polling:', error);
    }
  });

  // Cron 2: Auto-clean past events once a day at midnight (00:00)
  cron.schedule('0 0 * * *', async () => {
    console.log('[Daily Cleanup Job] Running once-a-day past event auto-clean (midnight)...');
    await cleanupPastEvents(null, 0);
  });
};

