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
        const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });
        
        const fullPrompt = `You are an AI assistant specialized in parsing emails to extract calendar events.
Respond ONLY with a valid JSON object matching this schema. Do not add markdown code blocks or commentary:
{
  "action": "CREATE" | "RESCHEDULE" | "CANCEL" | "NO_EVENT",
  "confidence": 0.95,
  "event": {
    "title": "string",
    "date": "YYYY-MM-DD",
    "startTime": "HH:MM",
    "endTime": "HH:MM",
    "location": "string",
    "description": "string"
  },
  "reasoning": "string"
}

Actions:
- CREATE: A new event is being proposed/scheduled.
- RESCHEDULE: An existing event is being modified.
- CANCEL: An existing event is being cancelled.
- NO_EVENT: No clear event information found.

${prompt}`;

        const result = await model.generateContent(fullPrompt);
        const rawText = result.response.text();
        const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        if ((error.status === 429 || error.message?.includes('429')) && retries > 0) {
            console.log(`Gemini rate limited (429), waiting ${delayMs / 1000}s before retry...`);
            await new Promise(r => setTimeout(r, delayMs));
            return callGemini(prompt, retries - 1, delayMs * 2);
        }
        console.error("Gemini parsing error:", error);
        return { action: 'NO_EVENT', confidence: 0, reasoning: "Error communicating with AI or parsing response", event: null };
    }
};

/**
 * Sends email to Gemini, gets structured JSON response
 * @param {Object} emailContent - Parsed email content
 * @param {Object|null} existingEvent - Existing event data if available
 * @returns {Promise<Object>}
 */
export const analyzeEmail = async (emailContent, existingEvent = null) => {
    let prompt = `Analyze this email:\nSubject: ${emailContent.subject}\nFrom: ${emailContent.from}\nDate: ${emailContent.date}\nBody: ${emailContent.body}\n`;
    
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
