import type { CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  Compass,
  FileCheck2,
  Layers3,
  Ruler,
} from "lucide-react";
import { LandingReveal } from "@/components/landing-reveal";

const revealDelay = (ms: number): CSSProperties =>
  ({ "--reveal-delay": `${ms}ms` }) as CSSProperties;

const heroSignals = [
  {
    icon: Ruler,
    title: "Feasibility first",
    copy: "Zoning, setbacks and coverage checked before you fall in love.",
  },
  {
    icon: Layers3,
    title: "Iterate with confidence",
    copy: "Compare options and trade-offs in minutes, not months.",
  },
  {
    icon: FileCheck2,
    title: "Design with context",
    copy: "Site-aware insight behind every line on the plan.",
  },
];

const painPoints = [
  { value: "18", unit: "wks", label: "From first brief to a validated concept, the old way" },
  { value: "4", unit: "rounds", label: "Of paid revisions before anyone checks the planning rules" },
  { value: "₹45", unit: "L+", label: "Committed before most families see a single measured plan" },
  { value: "0", unit: "", label: "Planning checks inside a mood board or a screenshot folder" },
];

const schemes = [
  { name: "Scheme A", current: true, feas: 86, coverage: "38%", coverageW: "76%", cost: "₹47.5 L", costW: "50%" },
  { name: "Scheme B", current: false, feas: 82, coverage: "35%", coverageW: "70%", cost: "₹44.9 L", costW: "33%" },
  { name: "Scheme C", current: false, feas: 88, coverage: "39%", coverageW: "78%", cost: "₹51.2 L", costW: "75%" },
];

const feasibilityChecks = [
  "Zoning",
  "Setbacks",
  "Coverage",
  "Height limit",
  "Parking",
  "Permeable area",
  "Overshadowing",
  "Orientation",
];

const drawingSet = [
  {
    sheet: "A·01",
    title: "Site plan",
    copy: "Setbacks, coverage and orientation resolved against your actual plot.",
  },
  {
    sheet: "A·02",
    title: "Ground floor",
    copy: "A room-by-room layout shaped around how your household really lives.",
  },
  {
    sheet: "A·03",
    title: "First floor",
    copy: "Stacked logically — structure, stairs and services where they belong.",
  },
  {
    sheet: "A·04",
    title: "Elevations",
    copy: "The street presence of your home, before a single brick is laid.",
  },
  {
    sheet: "A·05",
    title: "Shadow diagrams",
    copy: "Winter and summer sun traced across the day, so light is designed, not hoped for.",
  },
];

const costSegments = [
  { name: "Structure", pct: 41.2, amount: "₹19.5 L", tone: 1 },
  { name: "Finishes", pct: 23.8, amount: "₹11.3 L", tone: 2 },
  { name: "Services", pct: 13.5, amount: "₹6.4 L", tone: 3 },
  { name: "Site works", pct: 9.6, amount: "₹4.6 L", tone: 4 },
  { name: "Contingency", pct: 11.9, amount: "₹5.7 L", tone: 5 },
];

const traditionalPhases = [
  { phase: "Brief", weeks: 3 },
  { phase: "Concepts", weeks: 6 },
  { phase: "Revisions", weeks: 4 },
  { phase: "Feasibility", weeks: 5 },
];

const journey = [
  {
    step: "Start with your life",
    copy: "Share the plot, the rooms you need and how you want home to feel.",
  },
  {
    step: "Explore your possibilities",
    copy: "See thoughtful directions shaped around your priorities—not a generic template.",
  },
  {
    step: "Take the right idea forward",
    copy: "Leave with a concept you understand and the confidence to begin the real conversation.",
  },
];

function PlanBoard() {
  return (
    <div
      className="landing-board"
      role="img"
      aria-label="Concept board for a 650 square metre plot: ground floor plan with site summary, coverage and permeable area checks, and a feasibility score of 86 out of 100"
    >
      <aside className="landing-board-side">
        <p className="landing-board-title">Site summary</p>

        <dl className="landing-board-facts">
          <div>
            <dt>Site area</dt>
            <dd>650.0 m²</dd>
          </div>
          <div>
            <dt>Zoning</dt>
            <dd>GRZ1</dd>
          </div>
        </dl>

        <div className="landing-board-metric">
          <div className="landing-board-metric-head">
            <span>Coverage</span>
            <span>
              38% <em>· max 40%</em>
            </span>
          </div>
          <div className="landing-board-bar">
            <i className="landing-bar-fill" style={{ width: "76%" }} />
            <em className="landing-bar-marker" style={{ left: "80%" }} />
          </div>
        </div>

        <div className="landing-board-metric">
          <div className="landing-board-metric-head">
            <span>Permeable</span>
            <span>
              42% <em>· min 30%</em>
            </span>
          </div>
          <div className="landing-board-bar">
            <i className="landing-bar-fill" style={{ width: "84%" }} />
            <em className="landing-bar-marker" style={{ left: "60%" }} />
          </div>
        </div>

        <ul className="landing-board-checks">
          <li>
            <span>Setbacks</span>
            <span className="landing-board-ok">
              <Check aria-hidden="true" /> OK
            </span>
          </li>
          <li>
            <span>Height limit</span>
            <span className="landing-board-ok">
              <Check aria-hidden="true" /> OK
            </span>
          </li>
        </ul>

        <div className="landing-board-score">
          <svg viewBox="0 0 76 76" aria-hidden="true">
            <circle className="landing-score-track" cx="38" cy="38" r="32" />
            <circle className="landing-score-value" cx="38" cy="38" r="32" />
          </svg>
          <div className="landing-board-score-text">
            <b>
              86<span>/100</span>
            </b>
            <span>Feasibility</span>
          </div>
        </div>

        <div className="landing-board-set">
          <p className="landing-board-title">Drawing set</p>
          <ul>
            <li>
              <span>Site plan</span>
              <span>A·01</span>
            </li>
            <li className="is-active">
              <span>Ground floor</span>
              <span>A·02</span>
            </li>
            <li>
              <span>First floor</span>
              <span>A·03</span>
            </li>
            <li>
              <span>Elevations</span>
              <span>A·04</span>
            </li>
            <li>
              <span>Shadow diagrams</span>
              <span>A·05</span>
            </li>
          </ul>
        </div>
      </aside>

      <div className="landing-board-main">
        <div className="landing-board-meta">
          <span>Ground floor plan</span>
          <span>Sheet A·02 — 1:100</span>
        </div>

        <svg className="landing-board-drawing" viewBox="0 0 640 690" aria-hidden="true">
          <g className="landing-plan-grid">
            <rect x="64" y="72" width="500" height="532" />
            <path d="M92 136H538M92 202H538M92 268H538M92 334H538M92 400H538M92 466H538M92 532H538" />
            <path d="M126 96V578M192 96V578M258 96V578M324 96V578M390 96V578M456 96V578M522 96V578" />
          </g>
          <g className="landing-plan-setback">
            <rect x="96" y="104" width="436" height="468" strokeDasharray="7 6" />
          </g>
          <g className="landing-plan-dimension">
            <path d="M92 52H538M92 43V61M538 43V61M42 116V558M34 116H52M34 558H52" />
            <text x="294" y="37">18.20 M</text>
            <text transform="rotate(-90 24 355)" x="24" y="355">
              22.60 M
            </text>
          </g>
          <g className="landing-plan-trees">
            <circle cx="116" cy="122" r="17" />
            <path d="M116 105V139M99 122H133" />
            <circle cx="152" cy="106" r="9" />
            <circle cx="524" cy="132" r="19" />
            <path d="M524 113V151M505 132H543" />
            <circle cx="112" cy="546" r="18" />
            <path d="M112 528V564M94 546H130" />
            <circle cx="148" cy="570" r="9" />
            <circle cx="330" cy="562" r="12" />
            <path d="M330 550V574M318 562H342" />
          </g>
          <g className="landing-plan-walls">
            <path d="M168 178H374V242H470V396H420V514H228V468H168Z" />
            <path d="M168 318H292V468M292 242V468M374 242V396M228 468V514M324 396V514" />
            <path d="M470 304H420M168 382H228M292 318H374M374 456H420" />
          </g>
          <g className="landing-plan-furniture">
            <rect x="194" y="202" width="74" height="36" />
            <rect x="214" y="344" width="52" height="84" />
            <circle cx="346" cy="282" r="28" />
            <rect x="396" y="262" width="48" height="72" />
            <rect x="344" y="422" width="52" height="64" />
          </g>
          <g className="landing-plan-cars">
            <rect x="488" y="438" width="27" height="66" />
            <path d="M488 452H515M488 490H515" />
            <rect x="523" y="438" width="27" height="66" />
            <path d="M523 452H550M523 490H550" />
          </g>
          <g className="landing-plan-labels">
            <text x="206" y="160">LIVING</text>
            <text x="324" y="160">KITCHEN</text>
            <text x="352" y="232">DINING</text>
            <text x="186" y="304">COURT</text>
            <text x="328" y="382">SUITE</text>
            <text x="230" y="504">STUDIO</text>
            <text x="488" y="424">DRIVEWAY</text>
          </g>
          <g className="landing-plan-north">
            <circle cx="594" cy="96" r="20" />
            <path d="M594 68V124M580 96H608M594 76l-6 14h12Z" />
            <text x="590" y="60">N</text>
          </g>
          <g className="landing-plan-scale">
            <rect className="is-filled" x="64" y="652" width="55" height="5" />
            <rect x="119" y="652" width="82" height="5" />
            <rect className="is-filled" x="201" y="652" width="137" height="5" />
            <path d="M64 648V662M119 648V662M201 648V662M338 648V662" />
            <text x="60" y="676">0</text>
            <text x="113" y="676">2</text>
            <text x="195" y="676">5</text>
            <text x="326" y="676">10 M</text>
            <text x="420" y="676">PLOT 650.0 m²</text>
          </g>
        </svg>

        <div className="landing-board-titleblock">
          <div>
            <span>Built-up</span>
            <b>247.5 m²</b>
          </div>
          <div>
            <span>Concept cost</span>
            <b>₹44–51 L</b>
          </div>
          <div>
            <span>Drawn</span>
            <b>Sheet A·02</b>
          </div>
          <div>
            <span>Scale</span>
            <b>1:100</b>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const traditionalTotal = traditionalPhases.reduce((sum, item) => sum + item.weeks, 0);
  let cumulative = 0;

  return (
    <main className="landing">
      <LandingReveal />

      <section className="landing-hero" id="top">
        <header className="landing-header landing-shell">
          <Link className="landing-brand" href="#top" aria-label="BrickPilot home">
            BrickPilot
          </Link>
          <nav className="landing-nav" aria-label="Primary navigation">
            <a href="#studio">Studio</a>
            <a href="#drawing-set">Drawing set</a>
            <a href="#evidence">Evidence</a>
            <a href="#journey">How it works</a>
          </nav>
          <div className="landing-header-actions">
            <Link className="landing-signin" href="/login">
              Sign in
            </Link>
            <Link className="landing-header-cta" href="/workspace">
              Get started <ArrowUpRight aria-hidden="true" />
            </Link>
          </div>
        </header>

        <div className="landing-hero-grid landing-shell">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow landing-enter landing-enter-1">
              AI house feasibility studio
            </p>
            <h1 className="landing-enter landing-enter-2">
              Draw the house before the headache<span className="landing-dot">.</span>
            </h1>
            <p className="landing-hero-intro landing-enter landing-enter-3">
              Explore ideas. Test constraints. Validate feasibility — measured, costed and
              checked against your plot before you commit.
            </p>
            <div className="landing-actions landing-enter landing-enter-4">
              <Link className="landing-primary" href="/workspace">
                Start a project <ArrowRight aria-hidden="true" />
              </Link>
              <a className="landing-hero-link" href="#evidence">
                See the evidence
              </a>
            </div>

            <div className="landing-hero-signals landing-enter landing-enter-5">
              {heroSignals.map(({ icon: Icon, title, copy }) => (
                <article key={title}>
                  <Icon aria-hidden="true" />
                  <h2>{title}</h2>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="landing-board-wrap landing-enter landing-enter-3">
            <div className="landing-board-binder" aria-hidden="true" />
            <PlanBoard />
            <Compass className="landing-board-compass" aria-hidden="true" />
          </div>
        </div>

        <div className="landing-hero-foot landing-shell">
          <blockquote className="landing-hero-quote">
            <p>We draw nothing we can&apos;t defend.</p>
            <footer>Founder, BrickPilot</footer>
          </blockquote>
          <a className="landing-scroll" href="#stats" aria-label="Scroll to the problem, measured">
            <span>Scroll</span>
            <ArrowDown aria-hidden="true" />
          </a>
        </div>

        <div className="landing-ruler" aria-hidden="true">
          <svg viewBox="0 0 1600 26" preserveAspectRatio="none">
            {Array.from({ length: 161 }, (_, i) => (
              <line
                key={i}
                x1={i * 10}
                y1={i % 10 === 0 ? 2 : i % 5 === 0 ? 11 : 17}
                x2={i * 10}
                y2={25}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} style={{ left: `${i * 12.5}%` }}>
              {i * 20}
            </span>
          ))}
        </div>
      </section>

      <section className="landing-band landing-shell" id="stats" aria-label="The problem, measured">
        <p className="landing-sheet-marker landing-view-reveal">
          <span>The problem, measured</span>
          <i aria-hidden="true" />
        </p>
        <div className="landing-stats">
          {painPoints.map((stat, index) => (
            <div className="landing-stat landing-view-reveal" style={revealDelay(index * 90)} key={stat.label}>
              <p className="landing-stat-value">
                {stat.value}
                {stat.unit ? <span>{stat.unit}</span> : null}
              </p>
              <p className="landing-stat-label">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section landing-shell" id="studio">
        <div className="landing-lead landing-view-reveal">
          <div>
            <p className="landing-sheet-marker">
              <span>Set A</span>
              <i aria-hidden="true" />
            </p>
            <h2>The instruments behind every line.</h2>
          </div>
          <p className="landing-lead-copy">
            Four engines sit under every concept — so what you see is measured, costed and
            checked against your plot, never a pretty guess.
          </p>
        </div>

        <div className="landing-bento">
          <article className="landing-bento-cell is-tall landing-view-reveal">
            <p className="landing-bento-label">Feasibility engine</p>
            <h3>38 checks before you fall in love.</h3>
            <p>
              Every direction is run against your plot&apos;s planning scheme in seconds —
              not discovered later at the permit desk.
            </p>
            <ul className="landing-chip-grid">
              {feasibilityChecks.map((check) => (
                <li key={check}>
                  <Check aria-hidden="true" /> {check}
                </li>
              ))}
            </ul>
          </article>

          <article className="landing-bento-cell is-wide landing-view-reveal" style={revealDelay(80)}>
            <p className="landing-bento-label">Side by side</p>
            <h3>Every scheme, compared honestly.</h3>
            <div
              className="landing-compare"
              role="img"
              aria-label="Three schemes compared: scheme A coverage 38 percent, cost 47.5 lakh, feasibility 86; scheme B 35 percent, 44.9 lakh, 82; scheme C 39 percent, 51.2 lakh, 88"
            >
              {schemes.map((scheme) => (
                <div className="landing-scheme" key={scheme.name}>
                  <div className="landing-scheme-head">
                    <span>{scheme.name}</span>
                    {scheme.current ? <em>Current</em> : null}
                    <b>{scheme.feas}</b>
                  </div>
                  <div className="landing-scheme-row">
                    <span>Coverage {scheme.coverage}</span>
                    <div className="landing-mini-bar">
                      <i style={{ width: scheme.coverageW }} />
                    </div>
                  </div>
                  <div className="landing-scheme-row">
                    <span>Cost {scheme.cost}</span>
                    <div className="landing-mini-bar">
                      <i style={{ width: scheme.costW }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="landing-bento-cell landing-view-reveal" style={revealDelay(140)}>
            <p className="landing-bento-label">Cost model</p>
            <h3>Costed from day one.</h3>
            <p>A live estimate that moves with every iteration — no spreadsheet archaeology.</p>
            <p className="landing-range-figure">₹44–51 L</p>
            <p className="landing-range-caption">Estimated build cost, scheme A</p>
          </article>

          <article className="landing-bento-cell landing-view-reveal" style={revealDelay(200)}>
            <p className="landing-bento-label">Light &amp; shadow</p>
            <h3>Sun, tested by season.</h3>
            <p>Shadow diagrams across the day, winter and summer.</p>
            <svg className="landing-sun" viewBox="0 0 220 120" aria-hidden="true">
              <path d="M20 100 A90 90 0 0 1 200 100" strokeDasharray="4 5" />
              <line x1="8" y1="100" x2="212" y2="100" />
              <rect className="landing-sun-house" x="92" y="74" width="36" height="26" />
              <path className="landing-sun-shadow" d="M92 74 L58 100 M128 74 L162 100" />
              <circle className="landing-sun-dot" cx="32" cy="55" r="5" />
              <circle className="landing-sun-dot is-noon" cx="110" cy="10" r="6" />
              <circle className="landing-sun-dot" cx="188" cy="55" r="5" />
              <text x="14" y="114">9 AM</text>
              <text x="98" y="114">12 PM</text>
              <text x="176" y="114">3 PM</text>
            </svg>
          </article>

          <article className="landing-bento-cell is-strip landing-view-reveal" style={revealDelay(240)}>
            <svg className="landing-plot" viewBox="0 0 120 84" aria-hidden="true">
              <rect x="14" y="14" width="92" height="58" />
              <rect x="26" y="24" width="68" height="38" strokeDasharray="5 4" />
              <path d="M14 6 H106 M14 3 V9 M106 3 V9" />
            </svg>
            <div>
              <p className="landing-bento-label">Site-aware</p>
              <h3>Your plot, your rules.</h3>
              <p>
                Dimensions, orientation and the planning scheme are read before a single
                line is drawn.
              </p>
            </div>
            <ArrowRight className="landing-strip-arrow" aria-hidden="true" />
          </article>
        </div>
      </section>

      <section className="landing-section landing-shell" id="drawing-set">
        <div className="landing-lead landing-view-reveal">
          <div>
            <p className="landing-sheet-marker">
              <span>Set B</span>
              <i aria-hidden="true" />
            </p>
            <h2>Every concept leaves as a drawing set.</h2>
          </div>
          <p className="landing-lead-copy">
            Not a mood board, not a render to squint at — measured sheets you can hand to
            your family, your architect or your builder and start the real conversation.
          </p>
        </div>

        <div className="landing-sheets">
          {drawingSet.map((item, index) => (
            <article
              className="landing-sheet-row landing-view-reveal"
              style={revealDelay(index * 60)}
              key={item.sheet}
            >
              <span className="landing-sheet-no">{item.sheet}</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
              <ArrowRight aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" id="evidence">
        <div className="landing-shell">
          <div className="landing-lead landing-view-reveal">
            <div>
              <p className="landing-sheet-marker">
                <span>Set C</span>
                <i aria-hidden="true" />
              </p>
              <h2>Numbers you can defend.</h2>
            </div>
            <p className="landing-lead-copy">
              Each concept arrives with the arithmetic already done — cost, coverage and
              time — so a decision is a decision, not a guess.
            </p>
          </div>

          <div className="landing-evidence-grid">
            <article className="landing-panel landing-view-reveal">
              <div className="landing-panel-head">
                <h3>Where the money goes</h3>
                <p>₹47.5 L concept</p>
              </div>
              <div
                className="landing-cost-bar"
                role="img"
                aria-label="Cost allocation: structure 41.2 percent, finishes 23.8 percent, services 13.5 percent, site works 9.6 percent, contingency 11.9 percent"
              >
                {costSegments.map((segment) => (
                  <i key={segment.name} data-tone={segment.tone} style={{ width: `${segment.pct}%` }} />
                ))}
              </div>
              <ul className="landing-cost-legend">
                {costSegments.map((segment) => (
                  <li key={segment.name}>
                    <i data-tone={segment.tone} aria-hidden="true" />
                    <span className="landing-cost-name">{segment.name}</span>
                    <span className="landing-cost-pct">{segment.pct.toFixed(1)}%</span>
                    <span className="landing-cost-amount">{segment.amount}</span>
                  </li>
                ))}
              </ul>
              <p className="landing-panel-note">
                Illustrative split for a 247.5 m² concept, priced against current
                residential rates.
              </p>
            </article>

            <article className="landing-panel landing-view-reveal" style={revealDelay(90)}>
              <div className="landing-panel-head">
                <h3>Against the rules</h3>
                <p>GRZ1 · 650.0 m² plot</p>
              </div>

              <div
                className="landing-rule"
                role="img"
                aria-label="Site coverage: proposed 38 percent against a maximum of 40 percent"
              >
                <div className="landing-rule-head">
                  <span>Site coverage</span>
                  <span>
                    <b>38%</b> proposed · max 40%
                  </span>
                </div>
                <div className="landing-rule-bar">
                  <i className="landing-bar-fill" style={{ width: "76%" }} />
                  <em className="landing-bar-marker" style={{ left: "80%" }}>
                    <span>40</span>
                  </em>
                </div>
                <div className="landing-rule-scale">
                  <span>0</span>
                  <span>25</span>
                  <span>50%</span>
                </div>
              </div>

              <div
                className="landing-rule"
                role="img"
                aria-label="Permeable area: achieved 42 percent against a minimum of 30 percent"
              >
                <div className="landing-rule-head">
                  <span>Permeable area</span>
                  <span>
                    <b>42%</b> achieved · min 30%
                  </span>
                </div>
                <div className="landing-rule-bar">
                  <i className="landing-bar-fill" style={{ width: "84%" }} />
                  <em className="landing-bar-marker" style={{ left: "60%" }}>
                    <span>30</span>
                  </em>
                </div>
                <div className="landing-rule-scale">
                  <span>0</span>
                  <span>25</span>
                  <span>50%</span>
                </div>
              </div>

              <ul className="landing-rule-checks">
                {["Setbacks", "Height", "Parking", "Overshadowing"].map((check) => (
                  <li key={check}>
                    <Check aria-hidden="true" /> {check}
                  </li>
                ))}
              </ul>
              <p className="landing-panel-note">
                Every concept is checked against the planning scheme before you see it.
              </p>
            </article>

            <article className="landing-panel landing-panel-wide landing-view-reveal" style={revealDelay(140)}>
              <div className="landing-panel-head">
                <h3>Eighteen weeks, or two days</h3>
                <p>Time to a validated concept</p>
              </div>
              <div
                className="landing-tl"
                role="img"
                aria-label="Timeline comparison: the traditional route takes 18 weeks across brief, concepts, revisions and feasibility; BrickPilot takes 2 days"
              >
                <div className="landing-tl-row">
                  <span className="landing-tl-name">Traditional route</span>
                  <div className="landing-tl-track">
                    {traditionalPhases.map((item, index) => {
                      const left = (cumulative / 20) * 100;
                      cumulative += item.weeks;
                      return (
                        <span
                          className="landing-tl-segment"
                          data-tone={index + 1}
                          style={{ left: `${left}%`, width: `${(item.weeks / 20) * 100}%` }}
                          key={item.phase}
                        >
                          <b>{item.weeks}</b>
                          <em>{item.phase}</em>
                        </span>
                      );
                    })}
                  </div>
                  <span className="landing-tl-total">{traditionalTotal} wk</span>
                </div>

                <div className="landing-tl-row">
                  <span className="landing-tl-name">With BrickPilot</span>
                  <div className="landing-tl-track">
                    <span className="landing-tl-brickpilot" />
                    <span className="landing-tl-brickpilot-label">
                      Brief to validated concept
                    </span>
                  </div>
                  <span className="landing-tl-total is-fast">2 days</span>
                </div>

                <div className="landing-tl-scale">
                  <span aria-hidden="true" />
                  <div>
                    <span>0</span>
                    <span>5</span>
                    <span>10</span>
                    <span>15</span>
                    <span>20</span>
                  </div>
                  <span>weeks</span>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="landing-section landing-shell" id="journey">
        <div className="landing-journey">
          <div className="landing-journey-lead landing-view-reveal">
            <p className="landing-sheet-marker">
              <span>Set D</span>
              <i aria-hidden="true" />
            </p>
            <h2>From wish list to wow, in three moves.</h2>
          </div>
          <div className="landing-journey-list">
            {journey.map((item, index) => (
              <article
                className="landing-journey-item landing-view-reveal"
                style={revealDelay(index * 80)}
                key={item.step}
              >
                <span>0{index + 1}</span>
                <h3>{item.step}</h3>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-quote" id="promise" aria-label="The founder's promise">
        <div className="landing-shell">
          <blockquote className="landing-view-reveal">
            <div className="landing-sheet-marker">
              <span>The founder&apos;s promise</span>
              <i aria-hidden="true" />
            </div>
            <p>
              Every concept we draw is measured against your plot, checked against the
              planning rules and costed before you see it. If a direction can&apos;t
              survive that scrutiny, we won&apos;t show it to you. That is the promise.
            </p>
            <footer>
              <span>Founder, BrickPilot</span>
            </footer>
          </blockquote>
        </div>
      </section>

      <section className="landing-closing">
        <div className="landing-closing-inner landing-shell landing-view-reveal">
          <h2>Make the first decision feel like the right one.</h2>
          <Link className="landing-primary" href="/workspace">
            Start a project <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </section>

      <footer className="landing-footer landing-shell">
        <Link className="landing-brand" href="#top">
          BrickPilot
        </Link>
        <p>Imagine clearly. Decide confidently. Build beautifully.</p>
        <div>
          <Link href="/login">Sign in</Link>
          <Link href="/workspace">Start a project</Link>
          <a href="#top">Back to top</a>
        </div>
      </footer>
    </main>
  );
}
