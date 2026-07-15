import Link from "next/link";
import { ArrowUpRight, FileCheck2, Layers3, Ruler } from "lucide-react";

const signals = [
  { icon: Ruler, title: "Geometry first", detail: "A deterministic engine tiles the buildable footprint without overlaps." },
  { icon: Layers3, title: "Regenerate safely", detail: "Seeded variations change the plan while preserving every constraint." },
  { icon: FileCheck2, title: "Decide with evidence", detail: "Validation and cost expose expensive mistakes before the slab." },
];

export default function Home() {
  return (
    <main className="dark-sample">
      <div className="dark-sample-shell">
        <header className="dark-sample-header">
          <Link className="dark-sample-brand" href="/">BrickPilot</Link>
          <nav aria-label="Primary navigation" className="dark-sample-nav">
            <Link href="/layout-lab">Engine</Link>
            <a href="#method">Method</a>
            <a href="#proof">Proof</a>
          </nav>
          <Link className="dark-sample-signin" href="/login">Sign in</Link>
        </header>

        <section className="dark-sample-hero" id="method">
          <div className="dark-sample-copy">
            <p className="dark-sample-kicker">AI house feasibility studio</p>
            <h1>Draw the house before the headache<span>.</span></h1>
            <p className="dark-sample-intro">Turn a residential brief into grounded geometry, visible trade-offs, and a decision you can defend before construction begins.</p>
            <Link className="dark-sample-cta" href="/layout-lab">Inspect the engine <ArrowUpRight /></Link>
          </div>

          <div className="dark-sample-board-wrap" aria-label="Deterministic plan proof">
            <div className="dark-sample-binder" />
            <div className="dark-plan-board">
              <div className="dark-plan-meta"><span>30 × 50 / east</span><span>Seed 2026</span></div>
              <div className="dark-plan-drawing">
                <svg viewBox="0 0 640 640" role="img" aria-label="BrickPilot residential layout preview">
                  <g className="dark-plan-dimension"><path d="M92 48H548M92 40V58M548 40V58M48 92V548M40 92H58M40 548H58" /><text x="292" y="34">30 FT</text><text transform="rotate(-90 28 334)" x="28" y="334">50 FT</text></g>
                  <g className="dark-plan-walls"><rect x="92" y="92" width="456" height="456" /><path d="M92 258H352V92M352 258H548M286 258V548M420 258V548M92 406H286M286 388H420M420 420H548" /></g>
                  <g className="dark-plan-labels"><text x="180" y="180">LIVING</text><text x="418" y="180">BEDROOM</text><text x="155" y="338">DINING</text><text x="325" y="328">KITCHEN</text><text x="450" y="338">BATH</text><text x="155" y="482">SUITE</text><text x="330" y="482">BEDROOM</text><text x="458" y="482">UTILITY</text></g>
                  <g className="dark-plan-north"><circle cx="588" cy="102" r="20" /><path d="M588 74V130M574 102H602M588 82l-6 14h12Z" /><text x="584" y="66">N</text></g>
                </svg>
              </div>
              <div className="dark-plan-footer"><div><span>Coverage</span><b>100%</b></div><div><span>Overlaps</span><b>0</b></div><div><span>Floor</span><b>G</b></div></div>
            </div>
          </div>
        </section>

        <section className="dark-sample-signals" id="proof">
          {signals.map(({ icon: Icon, title, detail }) => <article key={title}><Icon /><div><h2>{title}</h2><p>{detail}</p></div></article>)}
        </section>
        <footer className="dark-sample-footer"><p>Catch the expensive mistakes on screen, not on the slab.</p><span>Single-floor concept feasibility</span></footer>
      </div>
    </main>
  );
}
