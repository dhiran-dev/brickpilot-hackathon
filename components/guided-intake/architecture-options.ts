import type { IntakeDraft } from "@/components/guided-intake/model";

export type ArchitecturePreviewOption<Value extends string> = {
  value: Value;
  title: string;
  detail: string;
  imageSrc: string;
  imageAlt: string;
  plate: string;
  available: boolean;
};

export const ARCHITECTURAL_STYLE_PREVIEWS = [
  {
    value: "modernist",
    title: "Modernist",
    detail: "Clear structural rhythm, strong horizontals and disciplined openings.",
    imageSrc: "/style-cards/modernist.png",
    imageAlt: "Modernist villa with a rigorous structural grid and horizontal roof planes",
    plate: "ST-05",
    available: true,
  },
  {
    value: "contemporary_tropical",
    title: "Contemporary tropical",
    detail: "Deep shade, screened openings, planted edges and warm natural finishes.",
    imageSrc: "/style-cards/contemporary-tropical.png",
    imageAlt: "Layered tropical villa with deep overhangs and screened terraces",
    plate: "ST-01",
    available: false,
  },
  {
    value: "kerala_contemporary",
    title: "Kerala contemporary",
    detail: "Regional roof cues and rain protection with clear, modern planning.",
    imageSrc: "/style-cards/kerala-contemporary.png",
    imageAlt: "Contemporary Kerala house with protective sloped roofs and shaded verandah",
    plate: "ST-02",
    available: false,
  },
  {
    value: "warm_minimal",
    title: "Warm minimal",
    detail: "Quiet planes, timber warmth and restrained, human-scaled detail.",
    imageSrc: "/style-cards/warm-minimal.png",
    imageAlt: "Minimal warm villa formed from calm plaster volumes and timber screens",
    plate: "ST-03",
    available: false,
  },
  {
    value: "courtyard_vernacular",
    title: "Courtyard vernacular",
    detail: "An inward-looking shaded heart with regionally grounded proportions.",
    imageSrc: "/style-cards/courtyard-vernacular.png",
    imageAlt: "Vernacular courtyard house arranged around a shaded planted centre",
    plate: "ST-04",
    available: false,
  },
] as const satisfies readonly ArchitecturePreviewOption<IntakeDraft["architecturalStyle"]>[];

export const FORM_STRATEGY_PREVIEWS = [
  {
    value: "stepped_terraces",
    title: "Stepped Villa",
    detail: "Receding levels create shaded entry courts and usable terraces.",
    imageSrc: "/style-cards/form-stepped-terraces.png",
    imageAlt: "Exploded massing diagram of a villa with three stepped terraces",
    plate: "FM-01",
    available: true,
  },
  {
    value: "articulated_wings",
    title: "Courts + wings",
    detail: "Connected room clusters frame practical side courts and an entry recess.",
    imageSrc: "/style-cards/form-articulated-wings.png",
    imageAlt: "Massing diagram of connected villa wings framing side courts",
    plate: "FM-02",
    available: false,
  },
  {
    value: "courtyard",
    title: "Courtyard form",
    detail: "Reserve an open-to-sky planning heart as part of the room brief.",
    imageSrc: "/style-cards/form-courtyard.png",
    imageAlt: "Ring-shaped villa massing diagram around an open central courtyard",
    plate: "FM-03",
    available: false,
  },
  {
    value: "compact",
    title: "Compact",
    detail: "An efficient envelope gains depth from shade and façade layers.",
    imageSrc: "/style-cards/form-compact.png",
    imageAlt: "Compact rectangular villa massing with a shaded façade layer",
    plate: "FM-04",
    available: false,
  },
] as const satisfies readonly ArchitecturePreviewOption<IntakeDraft["formStrategy"]>[];

export function constrainArchitectureChoices(draft: IntakeDraft): IntakeDraft {
  return {
    ...draft,
    architecturalStyle: "modernist",
    formStrategy: "stepped_terraces",
  };
}

export function formStrategyPatch(formStrategy: IntakeDraft["formStrategy"]): Pick<IntakeDraft, "formStrategy"> & Partial<Pick<IntakeDraft, "includeCourtyard">> {
  return formStrategy === "courtyard" ? { formStrategy, includeCourtyard: true } : { formStrategy };
}
