import ProcessedThread from '../models/ProcessedThread.js';

export const listEmails = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const emails = await ProcessedThread.find({ userId: req.user._id })
      .populate('linkedEvent')
      .sort({ lastProcessedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await ProcessedThread.countDocuments({ userId: req.user._id });

    res.status(200).json({
      success: true,
      data: {
        threads: emails,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit) || 1
        }
      }
    });
  } catch (error) {
    console.error('Error in listEmails:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch emails' });
  }
};

export const getThread = async (req, res) => {
  try {
    const { threadId } = req.params;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(threadId);
    const query = {
      userId: req.user._id,
      ...(isObjectId ? { $or: [{ gmailThreadId: threadId }, { _id: threadId }] } : { gmailThreadId: threadId })
    };

    const thread = await ProcessedThread.findOne(query)
      .populate('linkedEvent');

    if (!thread) {
      return res.status(404).json({ success: false, error: 'Thread not found' });
    }

    res.status(200).json({ success: true, data: thread });
  } catch (error) {
    console.error('Error in getThread:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch thread' });
  }
};
