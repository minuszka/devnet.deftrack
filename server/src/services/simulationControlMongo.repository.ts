import { SimulationControlRequest } from '../models/SimulationControlRequest.js';
import { SimulationRunArtifact } from '../models/SimulationRunArtifact.js';
import { SimulationRun } from '../models/SimulationRun.js';
import type {
  SimulationArtifactRecord,
  SimulationControlPersistenceRepository,
  SimulationControlRequestRecord,
} from './simulationControlPersistence.service.js';

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11_000;
}

export class MongoSimulationControlPersistenceRepository
  implements SimulationControlPersistenceRepository {
  async insertControlRequest(record: SimulationControlRequestRecord): Promise<'inserted' | 'existing'> {
    try {
      await SimulationControlRequest.create(record);
      return 'inserted';
    } catch (error) {
      if (isDuplicateKey(error)) return 'existing';
      throw error;
    }
  }

  async findControlRequest(requestKey: string): Promise<SimulationControlRequestRecord | null> {
    const found = await SimulationControlRequest.findOne({ requestKey })
      .select('-_id -createdAt')
      .lean();
    return found as SimulationControlRequestRecord | null;
  }

  async insertArtifact(record: SimulationArtifactRecord): Promise<'inserted' | 'existing'> {
    try {
      await SimulationRunArtifact.create(record);
      return 'inserted';
    } catch (error) {
      if (isDuplicateKey(error)) return 'existing';
      throw error;
    }
  }

  async findArtifact(artifactId: string): Promise<SimulationArtifactRecord | null> {
    const found = await SimulationRunArtifact.findOne({ artifactId })
      .select('-_id -createdAt')
      .lean();
    return found as SimulationArtifactRecord | null;
  }

  async listArtifacts(runKey: string): Promise<SimulationArtifactRecord[]> {
    const found = await SimulationRunArtifact.find({ runKey })
      .sort({ atMs: 1, artifactId: 1 })
      .select('-_id -createdAt')
      .lean();
    return found as unknown as SimulationArtifactRecord[];
  }

  async projectPreflight(input: Parameters<SimulationControlPersistenceRepository['projectPreflight']>[0]): Promise<boolean> {
    const result = await SimulationRun.updateOne(
      { runKey: input.runKey },
      { $set: { preflight: input.checks, dataQuality: input.dataQuality } }
    );
    return result.matchedCount === 1;
  }
}
