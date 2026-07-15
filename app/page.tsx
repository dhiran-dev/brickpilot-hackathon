export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <span className="font-mono text-xs uppercase tracking-widest text-muted">
        Phase 0 · scaffold
      </span>
      <h1 className="text-4xl font-black tracking-tight text-foreground">
        BrickPilot
      </h1>
      <p className="max-w-md text-lg text-muted">
        Type a sentence, get an accurate floor plan — validated for overlaps and
        omissions, costed, and rendered. Catch the expensive mistakes on screen,
        not on the slab.
      </p>
      <div className="mt-2 rounded-xl border border-border p-4 font-mono text-sm text-muted">
        Setup phase. Run{" "}
        <code className="text-foreground">bun run preflight</code> to verify DB,
        LLM, and image generation.
      </div>
    </main>
  );
}
