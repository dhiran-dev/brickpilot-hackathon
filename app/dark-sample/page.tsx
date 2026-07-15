import Link from "next/link";
import { ArrowUpRight, Compass, FileCheck2, Layers3, Ruler } from "lucide-react";

const signals = [
  {
    icon: Ruler,
    title: "Feasibility first",
    detail: "AI checks zoning, setbacks, coverage, and more.",
  },
  {
    icon: Layers3,
    title: "Iterate with confidence",
    detail: "Compare options and trade-offs in minutes.",
  },
  {
    icon: FileCheck2,
    title: "Design with context",
    detail: "Site-aware insight for clearer decisions.",
  },
];

function PlanBoard() {
  return (
    <div className="dark-plan-board" aria-label="Example concept board">
      <div className="dark-plan-meta">
        <span>Site summary</span>
        <span>1:100</span>
      </div>
      <div className="dark-plan-drawing">
        <svg viewBox="0 0 640 690" role="img" aria-label="Illustrative residential concept plan with measurements">
          <g className="dark-plan-lines">
            <rect x="64" y="72" width="500" height="532" />
            <path d="M92 136H538M92 202H538M92 268H538M92 334H538M92 400H538M92 466H538M92 532H538" />
            <path d="M126 96V578M192 96V578M258 96V578M324 96V578M390 96V578M456 96V578M522 96V578" />
          </g>
          <g className="dark-plan-dimension">
            <path d="M92 52H538M92 43V61M538 43V61M42 116V558M34 116H52M34 558H52" />
            <text x="294" y="37">18.20 M</text>
            <text transform="rotate(-90 24 355)" x="24" y="355">22.60 M</text>
          </g>
          <g className="dark-plan-walls">
            <path d="M168 178H374V242H470V396H420V514H228V468H168Z" />
            <path d="M168 318H292V468M292 242V468M374 242V396M228 468V514M324 396V514" />
            <path d="M470 304H420M168 382H228M292 318H374M374 456H420" />
          </g>
          <g className="dark-plan-furniture">
            <rect x="194" y="202" width="74" height="36" />
            <rect x="214" y="344" width="52" height="84" />
            <circle cx="346" cy="282" r="28" />
            <rect x="396" y="262" width="48" height="72" />
            <rect x="344" y="422" width="52" height="64" />
          </g>
          <g className="dark-plan-labels">
            <text x="206" y="160">LIVING</text>
            <text x="324" y="160">KITCHEN</text>
            <text x="352" y="232">DINING</text>
            <text x="186" y="304">COURTYARD</text>
            <text x="328" y="382">SUITE</text>
            <text x="230" y="504">STUDIO</text>
          </g>
          <g className="dark-plan-site">
            <path d="M94 100C142 128 112 166 90 194M538 100C510 128 544 164 558 194M96 592C142 566 112 534 90 502M538 592C510 562 544 534 558 504" />
            <path d="M94 100l-8-16m18 7 14-10M538 100l8-16m-18 7-14-10M96 592l-8 16m18-7 14 10M538 592l8 16m-18-7-14 10" />
          </g>
          <g className="dark-plan-north">
            <circle cx="594" cy="96" r="20" />
            <path d="M594 68V124M580 96H608M594 76l-6 14h12Z" />
            <text x="590" y="60">N</text>
          </g>
        </svg>
      </div>
      <div className="dark-plan-footer">
        <div><span>Built-up</span><b>128 m²</b></div>
        <div><span>Feasibility</span><b>86 / 100</b></div>
        <div><span>Concept cost</span><b>₹44–51 L</b></div>
      </div>
    </div>
  );
}

export default function DarkSamplePage() {
  return (
    <main className="dark-sample">
      <div className="dark-sample-shell">
        <header className="dark-sample-header">
          <Link className="dark-sample-brand" href="/dark-sample">
            BrickPilot
          </Link>
          <nav aria-label="Primary navigation" className="dark-sample-nav">
            <a href="#studio">Studio</a>
            <a href="#method">Method</a>
            <a href="#proof">Examples</a>
          </nav>
          <Link className="dark-sample-signin" href="/login">Sign in</Link>
        </header>

        <section className="dark-sample-hero" id="studio">
          <div className="dark-sample-copy">
            <p className="dark-sample-kicker">AI house feasibility studio</p>
            <h1>Draw the house before the headache<span>.</span></h1>
            <p className="dark-sample-intro">Explore ideas. Test constraints. Validate feasibility—before you commit.</p>
            <Link className="dark-sample-cta" href="/workspace">
              Start a project <ArrowUpRight aria-hidden="true" />
            </Link>
          </div>

          <div className="dark-sample-board-wrap" id="proof">
            <div className="dark-sample-binder" aria-hidden="true" />
            <PlanBoard />
            <Compass className="dark-sample-compass" aria-hidden="true" />
          </div>
        </section>

        <section className="dark-sample-signals" id="method" aria-label="BrickPilot capabilities">
          {signals.map(({ icon: Icon, title, detail }) => (
            <article key={title}>
              <Icon aria-hidden="true" />
              <div>
                <h2>{title}</h2>
                <p>{detail}</p>
              </div>
            </article>
          ))}
        </section>

        <footer className="dark-sample-footer">
          <p>BrickPilot helps us get to “yes” faster.</p>
          <span>Architect, Melbourne</span>
        </footer>
      </div>
    </main>
  );
}
