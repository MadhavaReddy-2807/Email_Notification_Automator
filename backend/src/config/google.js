import { google } from 'googleapis';
import { config } from './index.js';

export const getGoogleOAuthClient = () => {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
};
