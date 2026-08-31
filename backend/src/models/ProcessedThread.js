import mongoose from 'mongoose';

/**
 * ProcessedThread Model
 * Tracks email threads that have been processed to prevent duplicate processing.
 */
const processedThreadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'GmailAccount', required: true },
  gmailThreadId: { type: String, required: true },
  lastMessageId: { type: String },
  messageCount: { type: Number, default: 1 },
  linkedEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
  status: { type: String, enum: ['active', 'cancelled', 'no_event'], default: 'active' },
  threadSnippet: { type: String },
  firstProcessedAt: { type: Date, default: Date.now },
  lastProcessedAt: { type: Date, default: Date.now }
});

// Compound unique index
processedThreadSchema.index({ accountId: 1, gmailThreadId: 1 }, { unique: true });

const ProcessedThread = mongoose.model('ProcessedThread', processedThreadSchema);

export default ProcessedThread;
