import mongoose from 'mongoose';
import CryptoJS from 'crypto-js';

import { config } from '../config/index.js';
const ENCRYPTION_KEY = config.encryptionKey;

/**
 * GmailAccount Model
 * Stores linked Gmail account details and encrypted OAuth tokens.
 */
const gmailAccountSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  googleId: { type: String, required: true },
  email: { type: String, required: true },
  accessToken: { type: String, required: true },  // will be encrypted
  refreshToken: { type: String, default: '' },    // will be encrypted if present
  lastHistoryId: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  linkedAt: { type: Date, default: Date.now },
  lastPolledAt: { type: Date }
});

// Compound unique index for a user and email combination
gmailAccountSchema.index({ userId: 1, email: 1 }, { unique: true });

// Pre-save hook to encrypt tokens before saving to database
gmailAccountSchema.pre('save', function(next) {
  if (this.isModified('accessToken') && this.accessToken) {
    // Only encrypt if not already encrypted
    if (!this.accessToken.startsWith('U2FsdGVkX1')) {
      this.accessToken = CryptoJS.AES.encrypt(this.accessToken, ENCRYPTION_KEY).toString();
    }
  }
  if (this.isModified('refreshToken') && this.refreshToken) {
    // Only encrypt if not already encrypted
    if (!this.refreshToken.startsWith('U2FsdGVkX1')) {
      this.refreshToken = CryptoJS.AES.encrypt(this.refreshToken, ENCRYPTION_KEY).toString();
    }
  }
  next();
});

// Virtual method to get decrypted access token
gmailAccountSchema.methods.getDecryptedAccessToken = function() {
  if (!this.accessToken) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(this.accessToken, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted || this.accessToken;
  } catch (error) {
    console.error('Error decrypting access token', error);
    return this.accessToken;
  }
};

// Virtual method to get decrypted refresh token
gmailAccountSchema.methods.getDecryptedRefreshToken = function() {
  if (!this.refreshToken) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(this.refreshToken, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted || this.refreshToken;
  } catch (error) {
    console.error('Error decrypting refresh token', error);
    return this.refreshToken;
  }
};

const GmailAccount = mongoose.model('GmailAccount', gmailAccountSchema);

export default GmailAccount;
