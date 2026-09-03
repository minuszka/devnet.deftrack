import mongoose, { Schema, type Document } from 'mongoose';
import type { SimulationControlRole } from './SimulationControlRequest.js';

/**
 * A signed-in browser, on the server.
 *
 * The cookie carries only a random id; everything about the session lives here.
 * The id is stored hashed, so a copy of this collection signs nobody in. Rows
 * expire on their own through the TTL index -- a session that outlived its
 * deployment must not outlive its expiry.
 *
 * Never serialize this document through a public route.
 */
export interface AdminSessionDocument extends Document {
  idHash: string;
  subject: string;
  role: SimulationControlRole;
  csrfToken: string;
  createdAtMs: number;
  expiresAtMs: number;
  /** For the TTL index only: Mongo expires on a Date, the domain reasons in ms. */
  expiresAt: Date;
  revokedAtMs: number | null;
}

export const adminSessionSchema = new Schema<AdminSessionDocument>(
  {
    idHash: { type: String, required: true, unique: true, immutable: true },
    subject: { type: String, required: true, immutable: true },
    role: { type: String, enum: ['operator', 'safety-admin'], required: true, immutable: true },
    csrfToken: { type: String, required: true, immutable: true },
    createdAtMs: { type: Number, required: true, min: 0, immutable: true },
    expiresAtMs: { type: Number, required: true, min: 0, immutable: true },
    expiresAt: { type: Date, required: true, immutable: true },
    revokedAtMs: { type: Number, default: null, min: 0 },
  },
  { timestamps: false, strict: 'throw', versionKey: false }
);

// Mongo removes the row once expiresAt has passed. Expiry is also checked in
// the domain on every request, so the index is a sweeper, not the gate.
adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AdminSession = mongoose.model<AdminSessionDocument>('AdminSession', adminSessionSchema);
