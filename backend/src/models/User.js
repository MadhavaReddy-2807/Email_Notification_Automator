import mongoose from 'mongoose';

/**
 * User Model
 * Stores user details, settings, and references to their linked Gmail accounts.
 */
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  googleId: { type: String, required: true, unique: true }, // Google account ID for OAuth
  accounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GmailAccount' }],
  settings: {
    autoAdd: { type: Boolean, default: true },
    monitorLabels: { type: [String], default: ['INBOX'] },
    filterSenders: { type: [String], default: [] }
  }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

export default User;
