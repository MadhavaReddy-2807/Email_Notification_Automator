import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { config } from './index.js';
import User from '../models/User.js';
import GmailAccount from '../models/GmailAccount.js';

export const configurePassport = () => {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.google.clientId,
        clientSecret: config.google.clientSecret,
        callbackURL: config.google.redirectUri,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          let user = await User.findOne({ googleId: profile.id }).populate('accounts');
          
          if (!user) {
            user = new User({
              googleId: profile.id,
              name: profile.displayName,
              email: profile.emails?.[0]?.value || ''
            });
            await user.save();
            
            const account = new GmailAccount({
              userId: user._id,
              googleId: profile.id,
              email: profile.emails?.[0]?.value || '',
              accessToken,
              refreshToken: refreshToken || '',
              isActive: true
            });
            await account.save();
            
            user.accounts.push(account._id);
            await user.save();
          } else {
            // Update or create tokens for primary account
            let primaryAccount = await GmailAccount.findOne({ userId: user._id, googleId: profile.id });
            if (primaryAccount) {
              primaryAccount.accessToken = accessToken;
              if (refreshToken) {
                primaryAccount.refreshToken = refreshToken;
              }
              await primaryAccount.save();
            } else {
              primaryAccount = new GmailAccount({
                userId: user._id,
                googleId: profile.id,
                email: profile.emails?.[0]?.value || '',
                accessToken,
                refreshToken: refreshToken || '',
                isActive: true
              });
              await primaryAccount.save();
              if (!user.accounts.includes(primaryAccount._id)) {
                user.accounts.push(primaryAccount._id);
                await user.save();
              }
            }
          }
          
          return done(null, user);
        } catch (error) {
          console.error('Error in Google Strategy:', error);
          return done(error, null);
        }
      }
    )
  );

  passport.serializeUser((user, done) => {
    done(null, user._id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id).populate('accounts');
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });
};
