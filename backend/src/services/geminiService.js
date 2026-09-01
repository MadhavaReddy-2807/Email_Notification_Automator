import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';

const FALLBACK_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-preview-02-05',
  'gemini-2.0-flash',
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash',
  'gemini-2.0-flash-thinking-exp-01-21',
  'gemini-2.0-pro-exp-02-05',
  'gemini-1.5-pro',
  'gemma-2-27b-it',
  'gemma-2-9b-it'
];

/**
 * Helper to call Gemini and parse JSON with automatic model failover
 * @param {string} prompt 
 * @returns {Promise<Object>}
 */
const callGemini = async (prompt) => {
    const genAI = new GoogleGenerativeAI(config.gemini.apiKey || process.env.GEMINI_API_KEY);
    const fullPrompt = `You are an AI assistant specialized in deeply parsing emails to extract rich, comprehensive calendar events.
Respond ONLY with a valid JSON object matching this schema. Do not add markdown code blocks or commentary:
{
  "action": "CREATE" | "RESCHEDULE" | "CANCEL" | "NO_EVENT",
  "confidence": 0.95,
  "events": [
    {
      "title": "string",
      "date": "YYYY-MM-DD",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "location": "string",
      "meetingLink": "string or null",
      "description": "string",
      "organizer": "string or null",
      "importantNotes": "string or null"
    }
  ],
  "reasoning": "string"
}

Actions:
- CREATE: One or more new events/classes/sessions/meetings/webinars are being proposed/scheduled.
- RESCHEDULE: An existing event is being modified or moved to a new time/date.
- CANCEL: An existing event is being cancelled.
- NO_EVENT: No clear calendar event information found.

Comprehensive Extraction Guidelines:
- "events": If an email mentions multiple days or sessions (e.g. "Tuesday, Wednesday, Friday 9:00-10:00 AM, Saturday 10:00 AM-12:00 PM"), create a separate event entry for EACH distinct occurrence with its concrete calculated date in YYYY-MM-DD format!
- "title": Extract the full, professional name of the event, meeting, or class (e.g. "Ubiquitous Computing Class", "AI Automation Webinar", "Maths Class"). Do not truncate or omit words.
- "meetingLink": Extract any video conference, webinar, or meeting URL (Google Meet, Zoom, MS Teams, Webex, YouTube Live) along with any Passcodes/Meeting IDs found in the email.
- "location": Physical room/hall (e.g. "LT-31", "Auditorium 2") OR the meeting link if online. If both exist, specify the room as location.
- "description": Construct a complete, formatted, highly detailed overview including:
    * 📋 Agenda & Topics: What will be discussed or taught.
    * 🔗 Join Link & Passcode: Full meeting URL, Meeting ID, and Passcode if available.
    * 📚 Preparation / Prerequisites / Attached materials or Google Drive / Form links.
    * 👤 Host / Speaker / Professor details.
- "date": Concrete date in YYYY-MM-DD format based on the email context and send date.
- "startTime": 24-hour format HH:MM representing the exact local time in the email (e.g., "09:00", "12:30", "14:30", "18:00"). If the email says "12:30 PM" (afternoon), output "12:30". If it says "12:30 AM" (midnight), output "00:30". If it says "6:00 PM", output "18:00". Do NOT convert to UTC or apply any timezone shifts.
- "endTime": 24-hour format HH:MM. If omitted in email, set to 1 hour after startTime.

${prompt}`;

    for (const modelName of FALLBACK_MODELS) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(fullPrompt);
                const rawText = result.response.text();
                const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(cleaned);

                // Normalize single "event" into "events" array if needed
                if (parsed.event && (!parsed.events || parsed.events.length === 0)) {
                    parsed.events = [parsed.event];
                }
                if (!parsed.events) {
                    parsed.events = [];
                }

                return parsed;
            } catch (error) {
                const errorDetail = error.status ? `[Status ${error.status}] ${error.message}` : error.message;
                if (error.message?.includes('429') || error.status === 429) {
                    console.warn(`Model ${modelName} hit rate limit on attempt ${attempt + 1}. Waiting 3s...`);
                    await new Promise(r => setTimeout(r, 3000));
                } else {
                    console.warn(`Model ${modelName} error: ${errorDetail}`);
                    break;
                }
            }
        }
    }

    console.error("All Gemini fallback models exhausted for parsing.");
    return { action: 'NO_EVENT', confidence: 0, reasoning: "All AI model quotas temporarily rate limited", events: [] };
};

/**
 * Sends email to Gemini, gets structured JSON response
 * @param {Object} emailContent - Parsed email content
 * @param {Object|null} existingEvent - Existing event data if available
 * @returns {Promise<Object>}
 */
export const analyzeEmail = async (emailContent, existingEvent = null) => {
    let prompt = `Analyze this email (Sent Date: ${emailContent.date}):\nSubject: ${emailContent.subject}\nFrom: ${emailContent.from}\nDate: ${emailContent.date}\nBody: ${emailContent.body}\n`;
    
    if (existingEvent) {
        prompt += `\nExisting Event in Database:
Title: ${existingEvent.title}
Start: ${existingEvent.startTime}
End: ${existingEvent.endTime}
Status: ${existingEvent.status}

Determine if this email is a RESCHEDULE, CANCEL, or unrelated (NO_EVENT) for the existing event.`;
    }
    
    return await callGemini(prompt);
};

/**
 * Sends entire thread to Gemini for contextual analysis
 * @param {Array<Object>} threadMessages - Array of parsed messages
 * @param {Object|null} existingEvent - Existing event data if available
 * @returns {Promise<Object>}
 */
export const analyzeThread = async (threadMessages, existingEvent = null) => {
    let prompt = 'Analyze the following email thread context chronologically:\n\n';
    threadMessages.forEach((msg, idx) => {
        prompt += `--- Message ${idx + 1} (From: ${msg.from}, Date: ${msg.date}) ---\nSubject: ${msg.subject}\nBody: ${msg.body}\n\n`;
    });
    
    if (existingEvent) {
        prompt += `Existing Event in Database:
Title: ${existingEvent.title}
Start: ${existingEvent.startTime}
End: ${existingEvent.endTime}
Status: ${existingEvent.status}

Determine if the latest message is a RESCHEDULE, CANCEL, or unrelated for the existing event.`;
    }
    
    return await callGemini(prompt);
};

/**
 * Checks if a candidate event is a duplicate of any existing events
 * @param {Object} candidateEvent - Event extracted from AI
 * @param {Array<Object>} existingEvents - List of existing calendar events
 * @returns {Promise<{ isDuplicate: boolean, duplicateEventId: string|null, reasoning: string }>}
 */
export const checkIsDuplicateWithGemini = async (candidateEvent, existingEvents = []) => {
    if (!existingEvents || existingEvents.length === 0) {
        return { isDuplicate: false, duplicateEventId: null, reasoning: 'No existing events found in time window' };
    }

    const genAI = new GoogleGenerativeAI(config.gemini.apiKey || process.env.GEMINI_API_KEY);

    const prompt = `You are a Calendar Assistant checking for duplicate events.
Candidate Event to Add:
Title: ${candidateEvent.title}
Date: ${candidateEvent.date}
Start Time: ${candidateEvent.startTime}
End Time: ${candidateEvent.endTime}
Location: ${candidateEvent.location || ''}
Description: ${candidateEvent.description || ''}

Existing Events around this time:
${JSON.stringify(existingEvents.map(e => ({
    id: e.id || e._id,
    title: e.title || e.summary,
    startTime: e.startTime || e.start?.dateTime || e.start?.date,
    endTime: e.endTime || e.end?.dateTime || e.end?.date,
    location: e.location
})), null, 2)}

Determine if the Candidate Event represents the EXACT SAME real-world event/class as any existing event.
Respond ONLY with a JSON object:
{
  "isDuplicate": true | false,
  "duplicateEventId": "string or null",
  "reasoning": "brief explanation"
}`;

    for (const modelName of FALLBACK_MODELS) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            const rawText = result.response.text();
            const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
            return JSON.parse(cleaned);
        } catch (error) {
            console.warn(`Duplicate check on model ${modelName} failed: ${error.message}. Trying fallback...`);
        }
    }

    console.log(`Gemini duplicate check fallback to time/title matching`);
    const candidateTitle = (candidateEvent.title || '').toLowerCase().trim();
    const candidateDate = candidateEvent.date || '';

    const match = existingEvents.find(e => {
        const title = (e.title || e.summary || '').toLowerCase().trim();
        const start = String(e.startTime || e.start?.dateTime || e.start?.date || '');
        return (title.includes(candidateTitle) || candidateTitle.includes(title)) && (!candidateDate || start.includes(candidateDate));
    });

    if (match) {
        return {
            isDuplicate: true,
            duplicateEventId: match.id || match._id,
            reasoning: 'Matched by date and title similarity (algorithmic fallback)'
        };
    }

    return { isDuplicate: false, duplicateEventId: null, reasoning: 'No duplicate match found' };
};

