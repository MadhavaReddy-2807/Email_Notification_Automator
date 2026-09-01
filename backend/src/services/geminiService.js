import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index.js';

/**
 * Helper to call Gemini and parse JSON
 * @param {string} prompt 
 * @returns {Promise<Object>}
 */
const callGemini = async (prompt, retries = 2, delayMs = 2500) => {
    try {
        const genAI = new GoogleGenerativeAI(config.gemini.apiKey || process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        
        const fullPrompt = `You are an AI assistant specialized in parsing emails to extract calendar events.
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
      "description": "string"
    }
  ],
  "reasoning": "string"
}

Actions:
- CREATE: One or more new events/classes/sessions are being proposed/scheduled.
- RESCHEDULE: An existing event is being modified.
- CANCEL: An existing event is being cancelled.
- NO_EVENT: No clear event information found.

Extraction Guidelines:
- "events": If an email mentions multiple days or times (for example: "Tuesday, Wednesday, and Friday 9:00 AM to 10:00 AM, Saturday 10:00 AM to 12:00 Noon"), create a separate event entry for EACH distinct occurrence with its specific calculated date in YYYY-MM-DD format!
- "title": Extract the full, clean name of the event or class (e.g., "Ubiquitous Computing Class", "Maths Class"). Do not truncate or drop any initial letters.
- "date": Concrete date in YYYY-MM-DD format based on the email context/email send date. Calculate the exact day for mentioned days of week (e.g. Tuesday, Wednesday, etc.).
- "startTime": 24-hour format HH:MM representing the exact local time stated in the email (e.g., "09:00" for 9:00 AM, "19:30" for 7:30 PM). Do NOT convert to UTC.
- "endTime": 24-hour format HH:MM. If omitted or not mentioned, provide 1 hour after startTime.
- "location": Physical location (e.g. "LT-31"), room number, or meeting link (Zoom/Meet/Teams) if present.

${prompt}`;

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
        if ((error.status === 429 || error.message?.includes('429')) && retries > 0) {
            console.log(`Gemini rate limited (429), waiting ${delayMs / 1000}s before retry...`);
            await new Promise(r => setTimeout(r, delayMs));
            return callGemini(prompt, retries - 1, delayMs * 2);
        }
        console.error("Gemini parsing error:", error);
        return { action: 'NO_EVENT', confidence: 0, reasoning: "Error communicating with AI or parsing response", events: [] };
    }
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
        prompt += `\nExisting Event Context:\n${JSON.stringify(existingEvent, null, 2)}`;
    }
    
    return callGemini(prompt);
};

/**
 * Sends full thread context to Gemini
 * @param {Array<Object>} threadMessages - Array of parsed messages in the thread
 * @param {Object|null} existingEvent - Existing event data if available
 * @returns {Promise<Object>}
 */
export const analyzeThread = async (threadMessages, existingEvent = null) => {
    let prompt = `Analyze this email thread:\n\n`;
    threadMessages.forEach((msg, idx) => {
        prompt += `--- Message ${idx + 1} ---\nSubject: ${msg.subject}\nFrom: ${msg.from}\nDate: ${msg.date}\nBody: ${msg.body}\n\n`;
    });
    
    if (existingEvent) {
        prompt += `\nExisting Event Context:\n${JSON.stringify(existingEvent, null, 2)}`;
    }
    
    return callGemini(prompt);
};

/**
 * Uses Gemini to detect if a candidate event is a duplicate of an existing event
 * @param {Object} candidateEvent - { title, date, startTime, endTime, location }
 * @param {Array<Object>} existingEvents - List of existing events
 * @returns {Promise<{ isDuplicate: boolean, duplicateEventId: string|null, reasoning: string }>}
 */
export const checkIsDuplicateWithGemini = async (candidateEvent, existingEvents) => {
    if (!existingEvents || existingEvents.length === 0) {
        return { isDuplicate: false, duplicateEventId: null, reasoning: "No existing events to compare against." };
    }

    try {
        const genAI = new GoogleGenerativeAI(config.gemini.apiKey || process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const prompt = `You are a Calendar Assistant checking for duplicate events.
Candidate Event to Add:
${JSON.stringify(candidateEvent, null, 2)}

Existing Events on Calendar:
${JSON.stringify(existingEvents.map(e => ({
    id: e._id || e.id || e.calendarEventId,
    title: e.title || e.summary,
    startTime: e.startTime || e.start,
    endTime: e.endTime || e.end,
    location: e.location
})), null, 2)}

Determine if the Candidate Event is a duplicate or same meeting/class as any existing event.
Respond ONLY with a valid JSON object matching this schema:
{
  "isDuplicate": true | false,
  "duplicateEventId": "string or null",
  "reasoning": "string"
}`;

        const result = await model.generateContent(prompt);
        const cleaned = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (err) {
        console.warn("Gemini duplicate check fallback to time/title matching:", err.message);
        // Fallback: check exact date and start time match with similar title
        const candidateDateStr = candidateEvent.date || (candidateEvent.startTime ? new Date(candidateEvent.startTime).toISOString().split('T')[0] : '');
        const candidateTitleNorm = (candidateEvent.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        for (const existing of existingEvents) {
            const existingDateStr = existing.startTime ? new Date(existing.startTime).toISOString().split('T')[0] : '';
            const existingTitleNorm = (existing.title || existing.summary || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (candidateDateStr && existingDateStr === candidateDateStr && (candidateTitleNorm.includes(existingTitleNorm) || existingTitleNorm.includes(candidateTitleNorm))) {
                return {
                    isDuplicate: true,
                    duplicateEventId: existing._id?.toString() || existing.id || existing.calendarEventId,
                    reasoning: "Matched by date and title similarity"
                };
            }
        }
        return { isDuplicate: false, duplicateEventId: null, reasoning: "Fallback check found no duplicate." };
    }
};

