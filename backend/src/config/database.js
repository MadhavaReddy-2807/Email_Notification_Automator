import mongoose from 'mongoose';
import { config } from './index.js';

export const connectDB = async () => {
  try {
    console.log('Connecting to MongoDB...');
    const conn = await mongoose.connect(config.mongoUri, { 
      serverSelectionTimeoutMS: 10000,
      family: 4, // Force IPv4 to prevent Windows getaddrinfo IPv6 lookup failures
      maxPoolSize: 10,
      socketTimeoutMS: 45000,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error(`MongoDB error: ${err}`);
});
