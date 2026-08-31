import User from '../models/User.js';

export const getSettings = async (req, res) => {
  try {
    res.status(200).json({ success: true, data: req.user.settings });
  } catch (error) {
    console.error('Error in getSettings:', error);
    res.status(500).json({ success: false, error: 'Failed to get settings' });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const { autoAdd, monitorLabels, filterSenders } = req.body;
    
    const settings = { ...req.user.settings };
    
    if (typeof autoAdd === 'boolean') settings.autoAdd = autoAdd;
    if (Array.isArray(monitorLabels)) settings.monitorLabels = monitorLabels;
    if (Array.isArray(filterSenders)) settings.filterSenders = filterSenders;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { settings },
      { new: true }
    );

    res.status(200).json({ success: true, data: user.settings, message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Error in updateSettings:', error);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
};
