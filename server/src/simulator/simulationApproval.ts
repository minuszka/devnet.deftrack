import type { SimulationControlRole } from '../models/SimulationControlRequest.js';
import { SCENARIO_REGISTRY } from './scenarioRegistry.js';
import type { SimulationRiskClass, SimulationScenarioId } from './scenarioTypes.js';
import { SIMULATION_CONTROL_POLICY } from './simulationPolicy.js';

export interface SimulationApprovalDecision {
  allowed: boolean;
  scenarioId: SimulationScenarioId;
  riskClass: SimulationRiskClass;
  role: SimulationControlRole;
}

/**
 * Risk is server-owned scenario metadata, not a caller-controlled label.
 * The request acknowledgement prevents an operator approving a changed plan
 * without noticing, while the configured role decides whether it may proceed.
 */
export function authorizeSimulationApproval(input: {
  scenarioId: string;
  acknowledgedRiskClass: string;
  role: SimulationControlRole;
}): SimulationApprovalDecision {
  const descriptor = SCENARIO_REGISTRY[input.scenarioId as SimulationScenarioId];
  if (descriptor === undefined) throw new Error('unknown simulation scenario');
  if (input.acknowledgedRiskClass !== descriptor.riskClass) {
    throw new Error(`risk acknowledgement must equal ${descriptor.riskClass}`);
  }
  const allowedRiskClasses: readonly SimulationRiskClass[] = input.role === 'safety-admin'
    ? SIMULATION_CONTROL_POLICY.approval.safetyAdminRiskClasses
    : SIMULATION_CONTROL_POLICY.approval.operatorRiskClasses;
  const allowed = allowedRiskClasses.includes(descriptor.riskClass);
  return {
    allowed,
    scenarioId: descriptor.scenarioId,
    riskClass: descriptor.riskClass,
    role: input.role,
  };
}
