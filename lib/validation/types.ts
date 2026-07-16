export type ValidationSeverity = "error" | "warning" | "info";
export type ValidationCategory = "geometry" | "topology" | "opening" | "vertical" | "planning" | "structure" | "cost";

export type ValidationFinding = {
  ruleId: string;
  ruleVersion: number;
  severity: ValidationSeverity;
  category: ValidationCategory;
  floorId?: string;
  objectIds: string[];
  measured?: { value: number; unit: string };
  required?: { min?: number; max?: number; unit: string };
  message: string;
  suggestedAction?: string;
  repairType?: string;
  sourceKind: "geometry" | "baseline_heuristic" | "jurisdiction_source";
};

export type ValidationReport = {
  rulePackVersion: string;
  valid: boolean;
  score: number;
  counts: Record<ValidationSeverity, number>;
  findings: ValidationFinding[];
};
