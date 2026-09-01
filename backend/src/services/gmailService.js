import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config/index.js';

/**
 * Creates an authenticated OAuth2Client
 * @param {Object} account - User or Account document with tokens
 * @returns {OAuth2Client}
 */
const getOAuthClient = (account) => {
    const oauth2Client = new OAuth2Client(
        config.google.clientId,
        config.google.clientSecret
    );
    oauth2Client.setCredentials({
        access_token: account.getDecryptedAccessToken(),
        refresh_token: account.getDecryptedRefreshToken(),
    });
    
    // Add token refresh event listener to automatically get new token when using
    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        account.refreshToken = tokens.refresh_token;
      }
      account.accessToken = tokens.access_token;
      // Note: Ideally save this updated account to DB here
    });

    return oauth2Client;
};

/**
 * Creates an authenticated gmail client using account tokens
 * @param {Object} account - Account document with tokens
 * @returns {import('googleapis').gmail_v1.Gmail} Gmail API client
 */
export const getGmailClient = (account) => {
    const auth = getOAuthClient(account);
    return google.gmail({ version: 'v1', auth });
};

export const getRecentMessages = async (account, maxResults = 10) => {
    const gmail = getGmailClient(account);
    try {
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            maxResults,
            q: 'label:INBOX'
        });
        const messages = listRes.data.messages || [];
        return { messages, newHistoryId: profile.data.historyId };
    } catch (error) {
        console.error('Error fetching recent messages:', error);
        throw error;
    }
};

/**
 * Calls gmail.users.history.list since lastHistoryId, returns new message IDs
 * @param {Object} account - Account document with lastHistoryId
 * @returns {Promise<{messages: Array<{id: string, threadId: string}>, newHistoryId: string}>} Array of new message objects and new history ID
 */
export const getHistoryChanges = async (account) => {
    const gmail = getGmailClient(account);
    try {
        if (!account.lastHistoryId) {
            console.log(`Bootstrapping initial messages & historyId for ${account.email}...`);
            return await getRecentMessages(account, 10);
        }

        const response = await gmail.users.history.list({
            userId: 'me',
            startHistoryId: account.lastHistoryId,
        });

        const history = response.data.history || [];
        const messages = [];

        for (const record of history) {
            if (record.messagesAdded) {
                for (const msgAdded of record.messagesAdded) {
                    messages.push(msgAdded.message);
                }
            }
        }
        
        // Deduplicate messages by ID
        const uniqueMessages = [];
        const seenIds = new Set();
        for (const msg of messages) {
            if (!seenIds.has(msg.id)) {
                seenIds.add(msg.id);
                uniqueMessages.push(msg);
            }
        }

        return { messages: uniqueMessages, newHistoryId: response.data.historyId };
    } catch (error) {
        if (error.code === 404 || error.message?.includes('historyId')) {
            console.warn(`HistoryId expired or not found for ${account.email}, resetting to latest profile historyId...`);
            return await getRecentMessages(account, 10);
        }
        if (error.code === 401) {
            console.error(`Token expired for ${account.email}, will attempt to refresh internally or prompt re-auth.`);
        }
        console.error('Error fetching history changes:', error);
        throw error;
    }
};

/**
 * Fetches a single email message with full format
 * @param {import('googleapis').gmail_v1.Gmail} gmailClient 
 * @param {string} messageId 
 * @returns {Promise<Object>}
 */
export const getMessage = async (gmailClient, messageId) => {
    try {
        const response = await gmailClient.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full',
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching message ${messageId}:`, error);
        throw error;
    }
};

/**
 * Fetches full thread with all messages
 * @param {import('googleapis').gmail_v1.Gmail} gmailClient 
 * @param {string} threadId 
 * @returns {Promise<Object>}
 */
export const getThread = async (gmailClient, threadId) => {
    try {
        const response = await gmailClient.users.threads.get({
            userId: 'me',
            id: threadId,
            format: 'full',
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching thread ${threadId}:`, error);
        throw error;
    }
export const getInboxMessages = async (account, maxResults = 25) => {
    const gmail = getGmailClient(account);
    try {
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            maxResults,
            q: 'label:INBOX'
        });
        return listRes.data.messages || [];
    } catch (error) {
        console.error('Error fetching inbox messages:', error);
        throw error;
    }
};

/**
 * Extracts subject, from, to, date, body text from Gmail message format
 * Handles stripping HTML tags for AI processing
 * @param {Object} message - Gmail message object
 * @returns {Object} Parsed email details
 */
export const parseEmailContent = (message) => {
    const headers = message.payload?.headers || [];
    const getHeader = (name) => {
        const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
        return header ? header.value : '';
    };

    const parsed = {
        messageId: message.id,
        threadId: message.threadId,
        subject: getHeader('Subject'),
        from: getHeader('From'),
        to: getHeader('To'),
        date: getHeader('Date') || (message.internalDate ? new Date(parseInt(message.internalDate, 10)).toISOString() : ''),
        body: ''
    };

    const extractBody = (part) => {
        if (!part) return '';
        if (part.body && part.body.data) {
            const decoded = Buffer.from(part.body.data, 'base64url').toString('utf-8');
            if (part.mimeType === 'text/plain') {
                return decoded;
            } else if (part.mimeType === 'text/html') {
                // Strip HTML tags for AI processing
                return decoded.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
            }
        }
        if (part.parts) {
            return part.parts.map(p => extractBody(p)).join('\n');
        }
        return '';
    };

    const extracted = extractBody(message.payload);
    parsed.body = (extracted && extracted.trim().length > 0) ? extracted.trim() : (message.snippet || '');
    return parsed;
};

