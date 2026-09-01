import mongoose, { Schema, type Document } from 'mongoose';
import {
  SIMULATION_RUN_EVENT_TYPES,
  SIMULATION_RUN_STATUSES,
  type SimulationRunState,
  type SimulationRunStatus,
} from '../domain/simulationRunState.js';
import {
  simulationAuditActorSchema,
  simulationRunMetadataSchema,
  simulationRunStateSchema,
  type SimulationAuditActor,
  type SimulationRunMetadata,
} from './SimulationRun.js';

export type SimulationAuditEventType =
  | 'run_created'
  | (typeof SIMULATION_RUN_EVENT_TYPES)[number]
  | 'system_timeout'
  | 'system_resume_recovery'
  | 'action_created'
  | 'action_claimed'
  | 'action_result'
  | 'action_expired';

/**
 * Authoritative append-only event. The mutable run/action collections are
 * projections which can be repaired by replaying this stream.
 */
export interface SimulationAuditEventDocument extends Document {
  stream: 'run' | 'action';
  subjectId: string;
  runKey: string;
  eventId: string;
  sequence: number;
  eventType: SimulationAuditEventType;
  requestFingerprint: string;
  actor: SimulationAuditActor;
  atMs: number;
  fromStatus: SimulationRunStatus | null;
  toStatus: SimulationRunStatus | null;
  stateAfter: SimulationRunState | null;
  metadataOnCreate: SimulationRunMetadata | null;
  /** Reserved for the day-4 action reducer; never populated from raw API input. */
  actionAfter: Record<string, unknown> | null;
  createdAt: Date;
}

const eventTypes: readonly SimulationAuditEventType[] = [
  'run_created',
  ...SIMULATION_RUN_EVENT_TYPES,
  'system_timeout',
  'system_resume_recovery',
  'action_created',
  'action_claimed',
  'action_result',
  'action_expired',
];

export const simulationAuditEventSchema = new Schema<SimulationAuditEventDocument>(
  {
    stream: { type: String, enum: ['run', 'action'], required: true, immutable: true },
    subjectId: { type: String, required: true, immutable: true },
    runKey: { type: String, required: true, immutable: true },
    eventId: { type: String, required: true, immutable: true },
    sequence: { type: Number, required: true, min: 0, immutable: true },
    eventType: { type: String, enum: eventTypes, required: true, immutable: true },
    requestFingerprint: { type: String, required: true, immutable: true },
    actor: { type: simulationAuditActorSchema, required: true, immutable: true },
    atMs: { type: Number, required: true, min: 0, immutable: true },
    fromStatus: {
      type: String,
      enum: [...SIMULATION_RUN_STATUSES, null],
      default: null,
      immutable: true,
    },
    toStatus: {
      type: String,
      enum: [...SIMULATION_RUN_STATUSES, null],
      default: null,
      immutable: true,
    },
    stateAfter: { type: simulationRunStateSchema, default: null, immutable: true },
    metadataOnCreate: { type: simulationRunMetadataSchema, default: null, immutable: true },
    actionAfter: { type: Schema.Types.Mixed, default: null, immutable: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
    versionKey: false,
  }
);

simulationAuditEventSchema.index({ stream: 1, subjectId: 1, sequence: 1 }, { unique: true });
simulationAuditEventSchema.index({ runKey: 1, eventId: 1 }, { unique: true });
simulationAuditEventSchema.index({ runKey: 1, sequence: 1 });

simulationAuditEventSchema.pre('validate', function validateAuditShape() {
  if (this.stream === 'run') {
    if (
      this.subjectId !== this.runKey ||
      this.stateAfter === null ||
      this.stateAfter.runKey !== this.runKey ||
      this.stateAfter.revision !== this.sequence ||
      this.toStatus !== this.stateAfter.status
    ) {
      this.invalidate('stateAfter', 'run audit event must contain its matching state snapshot');
    }
    if (this.eventType === 'run_created' && this.metadataOnCreate === null) {
      this.invalidate('metadataOnCreate', 'run creation audit requires immutable metadata');
    }
    if (this.eventType !== 'run_created' && this.metadataOnCreate !== null) {
      this.invalidate('metadataOnCreate', 'run metadata is stored only on creation');
    }
  }
});

const appendOnlyError = (): Error =>
  new Error('SimulationAuditEvent is append-only; mutation and deletion are forbidden');

simulationAuditEventSchema.pre('save', function denyAuditResave() {
  if (!this.isNew) throw appendOnlyError();
});
simulationAuditEventSchema.pre('updateOne', function denyAuditUpdateOne() {
  throw appendOnlyError();
});
simulationAuditEventSchema.pre('updateMany', function denyAuditUpdateMany() {
  throw appendOnlyError();
});
simulationAuditEventSchema.pre('findOneAndUpdate', function denyAuditFindOneAndUpdate() {
  throw appendOnlyError();
});
simulationAuditEventSchema.pre('findOneAndReplace', function denyAuditFindOneAndReplace() {
  throw appendOnlyError();
});
simulationAuditEventSchema.pre('replaceOne', function denyAuditReplace() {
  throw appendOnlyError();
});
simulationAuditEventSchema.pre('deleteOne', function denyAuditDeleteOne() {
  throw appendOnlyError();
});
simulationAuditEventSchema.pre('deleteMany', function denyAuditDeleteMany() {
  throw appendOnlyError();
});
simulationAuditEventSchema.pre('findOneAndDelete', function denyAuditFindOneAndDelete() {
  throw appendOnlyError();
});
simulationAuditEventSchema.pre('bulkWrite', function denyAuditBulkWrite() {
  throw appendOnlyError();
});

export const SimulationAuditEvent = mongoose.model<SimulationAuditEventDocument>(
  'SimulationAuditEvent',
  simulationAuditEventSchema
);
