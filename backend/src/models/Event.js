import mongoose from 'mongoose';

/**
 * Event Model
 * Represents an event extracted from a processed email thread, linked to a calendar event.
 */
const eventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProcessedThread' },
  calendarEventId: { type: String },
  title: { type: String, required: true },
  description: { type: String },
  location: { type: String },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  status: { type: String, enum: ['scheduled', 'rescheduled', 'cancelled'], default: 'scheduled' },
  history: [{
    action: { type: String, enum: ['created', 'rescheduled', 'cancelled'] },
    previousStart: { type: Date },
    previousEnd: { type: Date },
    changedAt: { type: Date, default: Date.now },
    triggerEmailId: { type: String }
  }]
}, { timestamps: true });

const Event = mongoose.model('Event', eventSchema);

export default Event;
