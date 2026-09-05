import mongoose, { Schema, type Document } from 'mongoose';

/**
 * Secrets the server generates for itself and must remember.
 *
 * Only one so far: the key that turns a host address into a stable public
 * label. It is generated rather than configured on purpose -- a new required
 * environment variable would have to be set on the VPS before the next deploy,
 * and a deploy that forgot it would publish addresses again or lose every host
 * grouping on the site. Generated once and stored, it survives restarts, is
 * never served by any route, and needs no deployment change.
 *
 * Not `.env`, because the value only has to be stable, never shared, and the
 * database is already the thing that outlives a redeploy.
 */
export interface ServerSecretDocument extends Document {
  key: string;
  value: string;
  createdAt: Date;
}

const serverSecretSchema = new Schema<ServerSecretDocument>({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const ServerSecret = mongoose.model<ServerSecretDocument>('ServerSecret', serverSecretSchema);
