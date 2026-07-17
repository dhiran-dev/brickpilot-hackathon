import type { IntakeDraft } from "@/components/guided-intake/model";

export type ArchitecturePreviewOption<Value extends string> = {
  value: Value;
  title: string;
  detail: string;
  imageSrc: string;
  imageAlt: string;
  plate: string;
};

export const ARCHITECTURAL_STYLE_PREVIEWS = [
  {
    value: "contemporary_tropical",
    title: "Contemporary tropical",
    detail: "Deep shade, screened openings, planted edges and warm natural finishes.",
    imageSrc: "/style-cards/contemporary-tropical.svg",
    imageAlt: "Layered tropical villa with deep overhangs and screened terraces",
    plate: "ST-01",
  },
  {
    value: "kerala_contemporary",
    title: "Kerala contemporary",
    detail: "Regional roof cues and rain protection with clear, modern planning.",
    imageSrc: "/style-cards/kerala-contemporary.svg",
    imageAlt: "Contemporary Kerala house with protective sloped roofs and shaded verandah",
    plate: "ST-02",
  },
  {
    value: "warm_minimal",
    title: "Warm minimal",
    detail: "Quiet planes, timber warmth and restrained, human-scaled detail.",
    imageSrc: "/style-cards/warm-minimal.svg",
    imageAlt: "Minimal warm villa formed from calm plaster volumes and timber screens",
    plate: "ST-03",
  },
  {
    value: "courtyard_vernacular",
    title: "Courtyard vernacular",
    detail: "An inward-looking shaded heart with regionally grounded proportions.",
    imageSrc: "/style-cards/courtyard-vernacular.svg",
    imageAlt: "Vernacular courtyard house arranged around a shaded planted centre",
    plate: "ST-04",
  },
  {
    value: "modernist",
    title: "Modernist",
    detail: "Clear structural rhythm, strong horizontals and disciplined openings.",
    imageSrc: "/style-cards/modernist.svg",
    imageAlt: "Modernist villa with a rigorous structural grid and horizontal roof planes",
    plate: "ST-05",
  },
] as const satisfies readonly ArchitecturePreviewOption<IntakeDraft["architecturalStyle"]>[];

export const FORM_STRATEGY_PREVIEWS = [
  {
    value: "stepped_terraces",
    title: "Stepped villa",
    detail: "Receding levels create shaded entry courts and usable terraces.",
    imageSrc: "/style-cards/form-stepped-terraces.svg",
    imageAlt: "Exploded massing diagram of a villa with three stepped terraces",
    plate: "FM-01",
  },
  {
    value: "articulated_wings",
    title: "Courts + wings",
    detail: "Connected room clusters frame practical side courts and an entry recess.",
    imageSrc: "/style-cards/form-articulated-wings.svg",
    imageAlt: "Massing diagram of connected villa wings framing side courts",
    plate: "FM-02",
  },
  {
    value: "courtyard",
    title: "Courtyard form",
    detail: "Reserve an open-to-sky planning heart as part of the room brief.",
    imageSrc: "/style-cards/form-courtyard.svg",
    imageAlt: "Ring-shaped villa massing diagram around an open central courtyard",
    plate: "FM-03",
  },
  {
    value: "compact",
    title: "Compact",
    detail: "An efficient envelope gains depth from shade and façade layers.",
    imageSrc: "/style-cards/form-compact.svg",
    imageAlt: "Compact rectangular villa massing with a shaded façade layer",
    plate: "FM-04",
  },
] as const satisfies readonly ArchitecturePreviewOption<IntakeDraft["formStrategy"]>[];

export function formStrategyPatch(formStrategy: IntakeDraft["formStrategy"]): Pick<IntakeDraft, "formStrategy"> & Partial<Pick<IntakeDraft, "includeCourtyard">> {
  return formStrategy === "courtyard" ? { formStrategy, includeCourtyard: true } : { formStrategy };
}
