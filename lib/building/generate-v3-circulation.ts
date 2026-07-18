import { currentBuildingRequirementsSchema } from "@/lib/building/requirements";
import { generateV3AllocationStage, type V3AllocationDiagnostics } from "@/lib/building/generate-v3-allocation";
import { realizeV3Circulation, V3CirculationInfeasibleError, type V3CirculatedScheme } from "@/lib/building/candidates/v3-circulation";

export type V3CirculationDiagnostics = {
  contractVersion: "circulation-stage-v3";
  allocation: V3AllocationDiagnostics;
  attemptedSchemeCount: number;
  circulatedSchemeCount: number;
  rejectedSchemes: Array<{ allocationSchemeId: string; code: V3CirculationInfeasibleError["code"]; reason: string }>;
};

export type V3CirculationStageResult = {
  contractVersion: "circulation-stage-v3";
  schemes: V3CirculatedScheme[];
  selectedSchemeId: string;
  diagnostics: V3CirculationDiagnostics;
};

export class V3CirculationGenerationError extends Error {
  constructor(readonly code: "INVALID_V3_REQUIREMENTS" | "NO_FEASIBLE_CIRCULATION", message: string, readonly diagnostics?: Partial<V3CirculationDiagnostics>) {
    super(message);
    this.name = "V3CirculationGenerationError";
  }
}

export function generateV3CirculationStage(input: unknown): V3CirculationStageResult {
  const parsed = currentBuildingRequirementsSchema.safeParse(input);
  if (!parsed.success) throw new V3CirculationGenerationError("INVALID_V3_REQUIREMENTS", "V3 circulation requires valid schema-v3 requirements.");
  const allocation = generateV3AllocationStage(parsed.data);
  const schemes: V3CirculatedScheme[] = [];
  const rejectedSchemes: V3CirculationDiagnostics["rejectedSchemes"] = [];
  for (const scheme of allocation.schemes) {
    try {
      schemes.push(realizeV3Circulation(parsed.data, scheme));
    } catch (error) {
      if (!(error instanceof V3CirculationInfeasibleError)) throw error;
      rejectedSchemes.push({ allocationSchemeId: scheme.schemeId, code: error.code, reason: error.message });
    }
  }
  const diagnostics: V3CirculationDiagnostics = {
    contractVersion: "circulation-stage-v3",
    allocation: allocation.diagnostics,
    attemptedSchemeCount: allocation.schemes.length,
    circulatedSchemeCount: schemes.length,
    rejectedSchemes,
  };
  if (schemes.length === 0) throw new V3CirculationGenerationError("NO_FEASIBLE_CIRCULATION", "No allocated scheme can realize the required road-side arrival and vehicle apertures.", diagnostics);
  return { contractVersion: "circulation-stage-v3", schemes, selectedSchemeId: schemes[0].schemeId, diagnostics };
}
