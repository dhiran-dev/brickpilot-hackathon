export type PreviousSchemeRenderAsset = {
  id: string;
  role: string;
  url: string;
  contentType: string;
  index: number;
  schemeId: string | null;
  schemeDisposition: "previous";
};

export function PreviousSchemeRenderGallery({
  assets,
  schemeNameById,
}: {
  assets: readonly PreviousSchemeRenderAsset[];
  schemeNameById: ReadonlyMap<string, string>;
}) {
  if (assets.length === 0) return null;

  return (
    <section className="mt-5 border border-[#8e5a31]/45 bg-[#090908] p-5" aria-label="Previous scheme renders">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#8e5a31]/35 pb-4">
        <div>
          <p className="text-[0.8125rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">Previous scheme</p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl">Preserved render evidence</h2>
        </div>
        <p className="max-w-xl text-base leading-7 text-[#b5a697]">These images belong to the scheme selected before the confirmed switch. They are retained for comparison and are not evidence for the current geometry.</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {assets.map((asset) => {
          const schemeLabel = asset.schemeId ? schemeNameById.get(asset.schemeId) ?? asset.schemeId : "Legacy scheme";
          return (
            <article className="border border-[#8e5a31]/35 bg-[#171512]" data-scheme-id={asset.schemeId ?? "legacy"} key={asset.id}>
              <div className="relative aspect-[3/2] overflow-hidden">
                <img alt={`Previous scheme ${schemeLabel} · ${asset.role.replaceAll("_", " ")}`} className="h-full w-full object-cover opacity-75" loading="lazy" src={asset.url} />
                <span className="absolute left-2 top-2 bg-[#090908]/95 px-2 py-1 text-[0.8125rem] font-bold uppercase tracking-[0.1em] text-[#fff6ea]">Previous scheme · {schemeLabel}</span>
              </div>
              <p className="border-t border-[#8e5a31]/30 p-2 text-[0.8125rem] uppercase tracking-[0.09em] text-[#b5a697]">{asset.role.replaceAll("_", " ")}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
