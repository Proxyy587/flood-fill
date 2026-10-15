export interface NpcParams {
  panicMean: number;
  complianceMean: number;
  riskToleranceMean: number;
  altruismMean: number;
  awarenessMean: number;
  carOwnership: number;
  warningDelay: number;
  falseReportRate: number;
  commsDelay: number;
  staffFatigueRate: number;
}

export const DEFAULT_NPC_PARAMS: NpcParams = {
  panicMean: 0.3,
  complianceMean: 0.7,
  riskToleranceMean: 0.4,
  altruismMean: 0.5,
  awarenessMean: 0.6,
  carOwnership: 0.4,
  warningDelay: 120,
  falseReportRate: 0.1,
  commsDelay: 20,
  staffFatigueRate: 0.02,
};
