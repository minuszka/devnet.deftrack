import mongoose from 'mongoose';
import { config } from './config.js';
import { logger } from './utils/logger.js';

// Defense-in-depth: pin the strict modes explicitly so a future upgrade, or a
// stray `mongoose.set('strict', false)`, cannot silently persist or query
// unknown fields.
mongoose.set('strict', true);
mongoose.set('strictQuery', true);

export async function connectDatabase(): Promise<void> {
  const maxRetries = 5;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await mongoose.connect(config.mongoUri, {
        serverSelectionTimeoutMS: 10_000,
        maxPoolSize: config.env === 'production' ? 30 : 10,
        minPoolSize: 2,
        socketTimeoutMS: 45_000,
      });
      logger.info(`MongoDB connected (${mongoose.connection.db?.databaseName})`);
      break;
    } catch (error) {
      logger.error(`MongoDB connection attempt ${attempt}/${maxRetries} failed`, {
        error: error instanceof Error ? error.message : String(error),
      });
      if (attempt === maxRetries) throw error;
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  mongoose.connection.on('error', (err) => logger.error('MongoDB error', { error: err.message }));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
