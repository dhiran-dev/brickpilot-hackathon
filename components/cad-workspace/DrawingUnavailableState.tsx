import { Info } from "lucide-react";

export function DrawingUnavailableState() {
  return (
    <section className="border border-[#8e5a31]/55 bg-[#171512] p-6 text-[#fff6ea]" role="status">
      <Info className="h-5 w-5 text-[#c97940]" />
      <p className="mt-4 text-[0.8125rem] font-extrabold uppercase tracking-[0.14em] text-[#c97940]">Drawing not ready</p>
      <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl">There is no floor sheet to pin yet.</h2>
      <p className="mt-3 max-w-xl text-base leading-7 text-[#b5a697]">The study remains available. Adjust the room programme or floor allocation, then regenerate to create a new immutable drawing set.</p>
    </section>
  );
}
