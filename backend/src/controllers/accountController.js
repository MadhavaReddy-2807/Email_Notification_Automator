import { google } from 'googleapis';
import GmailAccount from '../models/GmailAccount.js';
import User from '../models/User.js';
import { config } from '../config/index.js';

/**
 * List all linked Gmail accounts for the current user
 */
export const listAccounts = async (req, res) => {
  try {
    const accounts = await GmailAccount.find({ userId: req.user._id }).select('-accessToken -refreshToken');
    res.status(200).json({ success: true, data: accounts });
  } catch (error) {
    console.error('Error in listAccounts:', error);
    res.status(500).json({ success: false, error: 'Failed to list accounts' });
  }
};

/**
 * Initiate OAuth to link another Gmail account
 */
export const linkAccount = (req, res) => {
  try {
    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      `${config.google.redirectUri.replace('/auth/google/callback', '/accounts/link/callback')}`
    );

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/gmail.readonly'
      ],
      state: req.user._id.toString()
    });

    res.status(200).json({ success: true, data: { url } });
  } catch (error) {
    console.error('Error in linkAccount:', error);
    res.status(500).json({ success: false, error: 'Failed to generate link URL' });
  }
};

/**
 * Handle OAuth callback for linking a new Gmail account
 */
export const linkAccountCallback = async (req, res) => {
  try {
    const { code, state: userId } = req.query;

    if (!code) {
      return res.redirect(`${config.frontendUrl}/accounts?error=no_code`);
    }

    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      `${config.google.redirectUri.replace('/auth/google/callback', '/accounts/link/callback')}`
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info for the linked account
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;
    const googleId = userInfo.data.id;

    // Check if account already linked
    let account = await GmailAccount.findOne({ userId, email });
    if (account) {
      // Update tokens for existing account
      account.accessToken = tokens.access_token;
      if (tokens.refresh_token) {
        account.refreshToken = tokens.refresh_token;
      }
      await account.save();
    } else {
      // Create new linked account
      account = new GmailAccount({
        userId,
        googleId,
        email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        isActive: true
      });
      await account.save();

      await User.findByIdAndUpdate(userId, {
        $addToSet: { accounts: account._id }
      });
    }

    res.redirect(`${config.frontendUrl}/accounts?success=account_linked`);
  } catch (error) {
    console.error('Error in linkAccountCallback:', error);
    res.redirect(`${config.frontendUrl}/accounts?error=link_failed`);
  }
};

/**
 * Unlink a Gmail account
 */
export const unlinkAccount = async (req, res) => {
  try {
    const { accountId } = req.params;
    const userId = req.user._id;

    const account = await GmailAccount.findOneAndDelete({ _id: accountId, userId });

    if (!account) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }

    await User.findByIdAndUpdate(userId, {
      $pull: { accounts: accountId }
    });

    res.status(200).json({ success: true, message: 'Account unlinked successfully' });
  } catch (error) {
    console.error('Error in unlinkAccount:', error);
    res.status(500).json({ success: false, error: 'Failed to unlink account' });
  }
};
