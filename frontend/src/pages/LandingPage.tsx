import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Leaf, ArrowRight, FileText, Check, Lightbulb, Target, FlaskConical,
  Sprout, TrendingUp, Users, ShieldCheck, MessagesSquare,
} from 'lucide-react';
import { APP_VERSION } from '@/version';

/* ---------------------------------------------------------------------------
 * Surveyor's-ledger redesign: deep pine + harvest ochre on warm paper,
 * serif display, monospace for scores/eyebrows. Tokens live in index.css.
 *
 * All factual claims mirror the real pipeline (python-service/app/agents):
 * 7 AIAIC parameter agents + extraction, debate, and scoring agents.
 * Chart numbers are illustrative and labeled as such in the UI.
 * ------------------------------------------------------------------------- */

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

/* ---------- primitives ---------- */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-pine">
      <span className="inline-block h-px w-6 bg-pine/55" />
      {children}
    </span>
  );
}

const btnPrimary =
  'inline-flex items-center gap-2 rounded-[2px] bg-pine px-5 py-3 font-mono text-sm tracking-wide text-paper ' +
  'shadow-[0_8px_20px_-12px_#1E5631] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_26px_-12px_#1E5631]';

const btnGhost =
  'inline-flex items-center gap-2 rounded-[2px] border border-line px-5 py-3 font-mono text-sm tracking-wide text-ink ' +
  'transition-colors duration-200 hover:border-pine hover:text-pine';

/* ---------- contour-line canvas backdrop ---------- */

function Contour({ light = false }: { light?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = light ? 'rgba(246,245,238,0.10)' : 'rgba(30,86,49,0.10)';
      ctx.lineWidth = 1;
      const rows = 26;
      for (let r = 0; r < rows; r++) {
        const baseY = (h / rows) * r + (h / rows) * 0.5;
        const amp = 10 + (r % 5) * 5;
        const freq = 0.008 + (r % 3) * 0.002;
        const phase = r * 0.6;
        ctx.beginPath();
        for (let x = -10; x <= w + 10; x += 8) {
          const y = baseY + Math.sin(x * freq + phase) * amp + Math.cos(x * freq * 0.5) * (amp * 0.3);
          if (x === -10) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };

    draw();
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(draw, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, [light]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

/* ---------- animated hero scorecard (illustrative sample) ---------- */

function useCountUp(target: number, start: boolean, duration = 1100) {
  const reduce = useReducedMotion();
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start) return;
    if (reduce) {
      setVal(target);
      return;
    }
    let raf: number;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, target, duration, reduce]);
  return val;
}

/*
 * Real AIAIC parameters and weights (scoring_agent.py PARAMETER_WEIGHTS).
 * The `sample` values are illustrative — internally consistent with the
 * sample overall of 82 (weighted sum), and labeled as sample data in the UI.
 */
const PARAMETERS = [
  { label: 'Problem relevance', weight: 15, sample: 84 },
  { label: 'Solution readiness', weight: 20, sample: 86 },
  { label: 'Pilot design', weight: 20, sample: 78 },
  { label: 'Farmer adoption', weight: 15, sample: 80 },
  { label: 'Scale-up potential', weight: 15, sample: 76 },
  { label: 'Team capacity', weight: 10, sample: 88 },
  { label: 'Compliance', weight: 5, sample: 90 },
];
const SAMPLE_OVERALL = 82; // weighted sum of the sample values above

function ScoreBar({ label, value, start }: { label: string; value: number; start: boolean }) {
  const n = useCountUp(value, start);
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1">
      <span className="font-mono text-xs text-ink-soft">{label}</span>
      <span className="font-mono text-sm tabular-nums text-ink">{start ? n : '—'}</span>
      <span className="col-span-2 h-1.5 overflow-hidden rounded-sm bg-line-soft">
        <i
          className="block h-full rounded-sm bg-chart-1 transition-[width] duration-1000 ease-out"
          style={{ width: start ? `${value}%` : 0 }}
        />
      </span>
    </div>
  );
}

function Scorecard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const overall = useCountUp(SAMPLE_OVERALL, inView, 1300);
  const CIRC = 289;

  return (
    <div ref={ref} className="overflow-hidden rounded-md border border-line bg-surface shadow-card">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line-soft bg-surface-2 px-5 py-4">
        <span className="flex items-center gap-2 font-mono text-xs text-ink-soft">
          <FileText className="h-3.5 w-3.5" />
          <b className="font-semibold text-ink">What an evaluation returns</b>
        </span>
        <span className="inline-flex items-center gap-2 rounded-[2px] border border-harvest/40 px-2 py-0.5 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-harvest">
          Sample data
        </span>
      </div>

      {/* body */}
      <div className="px-5 pb-6 pt-6">
        <div className="mb-6 flex items-center gap-5 max-sm:flex-col max-sm:items-start">
          {/* gauge */}
          <div className="relative h-[104px] w-[104px] flex-none">
            <svg width="104" height="104" viewBox="0 0 104 104" className="-rotate-90">
              <circle cx="52" cy="52" r="46" fill="none" stroke="var(--color-line)" strokeWidth="8" />
              <circle
                cx="52" cy="52" r="46" fill="none"
                stroke="var(--color-chart-1)" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={inView ? CIRC - (CIRC * SAMPLE_OVERALL) / 100 : CIRC}
                style={{ transition: 'stroke-dashoffset 1.3s cubic-bezier(0.22,1,0.36,1)' }}
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <b className="block font-serif text-4xl leading-none">{overall}</b>
                <small className="font-mono text-[0.56rem] uppercase tracking-[0.16em] text-ink-faint">Overall</small>
              </div>
            </div>
          </div>
          {/* verdict */}
          <div>
            <div className="font-serif text-xl">Recommendation level</div>
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-[2px] border border-chart-1/40 px-2 py-0.5 font-mono text-[0.68rem] uppercase tracking-wider text-chart-1">
              <Check className="h-3 w-3" strokeWidth={2.4} />
              Recommended
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Every evaluation returns a weighted 0–100 score, a recommendation level, and
              per-parameter findings with evidence from the proposal.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {PARAMETERS.map((p) => (
            <ScoreBar key={p.label} label={p.label} value={p.sample} start={inView} />
          ))}
        </div>
        <p className="mt-4 font-mono text-[0.66rem] text-ink-faint">
          Parameters and weights are the real AIAIC rubric; scores shown are illustrative.
        </p>
      </div>
    </div>
  );
}

/* ---------- radar comparison chart (illustrative sample) ---------- */

const RADAR_AXES = ['Problem', 'Readiness', 'Pilot', 'Adoption', 'Scale-up', 'Team', 'Compliance'];
const RADAR_A = [84, 86, 78, 80, 76, 88, 90]; // matches the sample scorecard
const RADAR_B = [70, 62, 82, 74, 68, 80, 85];

function Radar() {
  const cx = 170, cy = 145, R = 100;
  const pt = (i: number, val: number): [number, number] => {
    const ang = (Math.PI * 2 * i) / RADAR_AXES.length - Math.PI / 2;
    const rr = (R * val) / 100;
    return [cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr];
  };
  const ring = (lvl: number) =>
    RADAR_AXES.map((_, i) => pt(i, lvl).map((n) => n.toFixed(1)).join(' ')).join(' L ');
  const poly = (vals: number[]) =>
    vals.map((v, i) => pt(i, v).map((n) => n.toFixed(1)).join(' ')).join(' L ');

  return (
    <svg viewBox="0 0 340 300" width="100%" role="img" aria-label="Radar chart comparing two proposals across the seven AIAIC parameters (sample data)">
      {[25, 50, 75, 100].map((lvl) => (
        <path key={lvl} d={`M ${ring(lvl)} Z`} fill="none" stroke="var(--color-line)" strokeWidth="1" />
      ))}
      {RADAR_AXES.map((label, i) => {
        const end = pt(i, 100);
        const lp = pt(i, 126);
        return (
          <g key={label}>
            <line x1={cx} y1={cy} x2={end[0]} y2={end[1]} stroke="var(--color-line)" strokeWidth="1" />
            <text
              x={lp[0]} y={lp[1]} textAnchor="middle" dominantBaseline="middle"
              className="font-mono" fontSize="10" fill="var(--color-ink-soft)"
            >
              {label}
            </text>
          </g>
        );
      })}
      <path d={`M ${poly(RADAR_B)} Z`} fill="rgba(192,122,40,0.16)" stroke="var(--color-chart-2)" strokeWidth="2" strokeLinejoin="round" />
      <path d={`M ${poly(RADAR_A)} Z`} fill="rgba(46,139,68,0.18)" stroke="var(--color-chart-1)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- content (mirrors python-service/app/agents) ---------- */

const MEASURES = [
  {
    idx: '01', weight: 'weight 15%', icon: Target, title: 'Problem relevance',
    desc: 'Is the problem real, urgent, and specific to the farmers and regions it names?',
  },
  {
    idx: '02', weight: 'weight 20%', icon: Lightbulb, title: 'Solution readiness',
    desc: 'Has the solution been piloted? Deployments, farmer counts, and measurable outcomes weigh heaviest.',
  },
  {
    idx: '03', weight: 'weight 20%', icon: FlaskConical, title: 'Pilot design',
    desc: 'Is the proposed pilot concrete — location, scale, duration, and success metrics?',
  },
  {
    idx: '04', weight: 'weight 15%', icon: Sprout, title: 'Farmer adoption',
    desc: 'Will farmers actually use it? Usability, affordability, and the path to trust.',
  },
  {
    idx: '05', weight: 'weight 15%', icon: TrendingUp, title: 'Scale-up potential',
    desc: 'Can it grow beyond the pilot — unit economics, infrastructure, and partnerships?',
  },
  {
    idx: '06', weight: 'weight 10%', icon: Users, title: 'Team capacity',
    desc: 'Does the team combine genuine AI/ML capability with agricultural domain expertise?',
  },
  {
    idx: '07', weight: 'weight 5%', icon: ShieldCheck, title: 'Compliance',
    desc: 'Data protection, regulatory fit, and the requirements of the challenge itself.',
  },
  {
    idx: '08', weight: 'meta', icon: MessagesSquare, title: 'Cross-agent debate',
    desc: 'Before scoring, a debate agent detects conflicts between agent findings and resolves them.',
  },
];

const FLOW = [
  { n: 1, title: 'Upload', desc: 'Drop in the proposal document. The service parses it and routes each section to the right agent.' },
  { n: 2, title: 'Extract', desc: 'An extraction agent pulls the structured facts the evaluators will judge.' },
  { n: 3, title: 'Evaluate & debate', desc: 'Seven parameter agents score their own dimension; a debate agent resolves conflicts between them.' },
  { n: 4, title: 'Score & report', desc: 'A scoring agent synthesizes the weighted verdict — score, recommendation level, strengths, and red flags.' },
];

const COMPARE_POINTS = [
  { title: 'Radar overlay.', desc: 'See where one proposal out-scores another at a glance, parameter by parameter.' },
  { title: 'Consistent grading.', desc: 'The same rubric runs on every proposal, so the comparison is fair rather than anecdotal.' },
  { title: 'Ranked shortlists.', desc: 'Evaluate a batch and let the weighted totals order the committee shortlist.' },
];

/* ---------- page ---------- */

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[3px] bg-pine text-paper">
        <Leaf className="h-[19px] w-[19px]" strokeWidth={1.8} />
      </span>
      <span className="leading-tight">
        <span className="flex items-center gap-1.5">
          <span className="font-serif text-xl tracking-tight">
            Agri<i className="italic text-harvest">Eval</i>
          </span>
          <span className="rounded-[2px] border border-harvest/40 px-1.5 py-0.5 font-mono text-[0.56rem] uppercase tracking-[0.14em] text-harvest">Beta v{APP_VERSION}</span>
        </span>
        <span className="block font-mono text-[0.6rem] uppercase tracking-[0.14em] text-ink-faint">
          AIAIC Evaluation Portal
        </span>
      </span>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Official strip */}
      <div className="bg-pine-deep py-1.5 text-center font-mono text-[0.66rem] uppercase tracking-[0.18em] text-paper/85">
        AI in Agriculture Innovation Challenge (AIAIC) · Proposal Evaluation Portal
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-line-soft bg-paper/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-[1180px] items-center justify-between px-6 lg:px-10">
          <Brand />
          <nav className="hidden items-center gap-8 font-mono text-xs tracking-wide text-ink-soft md:flex">
            <a href="#measure" className="transition-colors hover:text-ink">What we measure</a>
            <a href="#flow" className="transition-colors hover:text-ink">How it works</a>
            <a href="#compare" className="transition-colors hover:text-ink">Compare</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className={btnGhost}>Sign in</Link>
            <Link to="/upload" className={btnPrimary}>
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line-soft">
        <Contour />
        <div className="relative z-[1] mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-10 px-6 pb-16 pt-16 md:pt-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-10">
          <div>
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              <Eyebrow>AIAIC proposal evaluation</Eyebrow>
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="mt-6 font-serif text-5xl leading-[1.08] tracking-tight text-balance md:text-6xl lg:text-7xl"
            >
              Every proposal, judged on the
              <br />
              <em className="italic text-harvest">same seven parameters.</em>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="mt-6 max-w-[36ch] text-lg leading-snug text-ink-soft md:text-xl"
            >
              Ten cooperating AI agents read each AIAIC proposal and grade it across the official
              seven-parameter rubric — from problem relevance to compliance — into one weighted,
              explainable verdict for the evaluation committee.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3 }}
              className="mt-9 flex flex-wrap gap-3"
            >
              <Link to="/upload" className={btnPrimary}>
                Evaluate a proposal
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/login" className={btnGhost}>Sign in</Link>
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.5 }}
              className="mt-10 flex flex-wrap gap-x-8 gap-y-3 font-mono text-xs text-ink-faint"
            >
              {[
                <><b className="font-normal text-ink">7</b> evaluation parameters</>,
                <><b className="font-normal text-ink">10</b> AI agents in the pipeline</>,
                <>one weighted <b className="font-normal text-ink">0–100</b> score</>,
              ].map((item, i) => (
                <span key={i} className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 flex-none rounded-full bg-harvest" />
                  {item}
                </span>
              ))}
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.35 }}
            className="max-lg:max-w-[460px]"
          >
            <Scorecard />
          </motion.div>
        </div>
      </section>

      {/* What we measure */}
      <section id="measure" className="py-16 md:py-24">
        <div className="mx-auto max-w-[1180px] px-6 lg:px-10">
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true }}
            className="mb-12 max-w-[60ch]"
          >
            <motion.div variants={fadeUp} custom={0}><Eyebrow>The rubric</Eyebrow></motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="mt-4 font-serif text-4xl tracking-tight text-balance md:text-5xl">
              Seven parameters, one dedicated agent each.
            </motion.h2>
            <motion.p variants={fadeUp} custom={2} className="mt-4 text-lg leading-relaxed text-ink-soft">
              Every proposal is graded on the same AIAIC evaluation rubric, so applicants are treated
              consistently. Each parameter has its own specialized agent, and the weights below roll
              their scores into the final verdict.
            </motion.p>
          </motion.div>

          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {MEASURES.map((m, i) => (
              <motion.div
                key={m.title} custom={i} initial="hidden" whileInView="visible"
                viewport={{ once: true }} variants={fadeUp}
                className="flex min-h-[210px] flex-col gap-3.5 bg-surface p-6 transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center justify-between font-mono text-[0.7rem] tracking-widest text-ink-faint">
                  <span>{m.idx}</span>
                  <span className="text-harvest">{m.weight}</span>
                </div>
                <div className="grid h-10 w-10 place-items-center rounded bg-pine/10 text-pine">
                  <m.icon className="h-[21px] w-[21px]" strokeWidth={1.7} />
                </div>
                <h3 className="font-serif text-2xl">{m.title}</h3>
                <p className="text-sm leading-relaxed text-ink-soft">{m.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="flow" className="border-y border-line-soft bg-paper-2 py-16 md:py-24">
        <div className="mx-auto max-w-[1180px] px-6 lg:px-10">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="mb-12 max-w-[60ch]">
            <motion.div variants={fadeUp} custom={0}><Eyebrow>The pipeline</Eyebrow></motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="mt-4 font-serif text-4xl tracking-tight text-balance md:text-5xl">
              From document to decision in four passes.
            </motion.h2>
          </motion.div>

          <div className="grid grid-cols-1 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
            {FLOW.map((s, i) => (
              <motion.div
                key={s.n} custom={i} initial="hidden" whileInView="visible"
                viewport={{ once: true }} variants={fadeUp}
                className="relative pr-6"
              >
                {i < FLOW.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-10 right-3 top-[15px] hidden h-px lg:block"
                    style={{ background: 'repeating-linear-gradient(90deg, var(--color-line) 0 6px, transparent 6px 12px)' }}
                  />
                )}
                <span className="relative z-[1] grid h-[30px] w-[30px] place-items-center rounded-full border border-pine bg-paper-2 font-mono text-xs text-pine">
                  {s.n}
                </span>
                <h3 className="mt-4 font-serif text-xl">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Compare */}
      <section id="compare" className="py-16 md:py-24">
        <div className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-10 px-6 lg:grid-cols-2 lg:gap-16 lg:px-10">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }}>
            <motion.div variants={fadeUp} custom={0}><Eyebrow>Side by side</Eyebrow></motion.div>
            <motion.h2 variants={fadeUp} custom={1} className="mt-4 font-serif text-4xl tracking-tight text-balance md:text-5xl">
              Put two proposals on the same axes.
            </motion.h2>
            <motion.ul variants={fadeUp} custom={2} className="mt-7 flex list-none flex-col gap-4 p-0">
              {COMPARE_POINTS.map((p) => (
                <li key={p.title} className="flex items-start gap-3">
                  <Check className="mt-0.5 h-5 w-5 flex-none text-pine" strokeWidth={2} />
                  <div>
                    <b className="font-semibold">{p.title}</b>
                    <p className="mt-0.5 text-sm text-ink-soft">{p.desc}</p>
                  </div>
                </li>
              ))}
            </motion.ul>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ duration: 0.7 }}
            className="rounded-md border border-line bg-surface p-6 shadow-card"
          >
            <Radar />
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-ink-soft">
              <span className="inline-flex items-center gap-2">
                <span className="h-[11px] w-[11px] flex-none rounded-sm bg-chart-1" />
                Proposal A
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-[11px] w-[11px] flex-none rounded-sm bg-chart-2" />
                Proposal B
              </span>
              <span className="text-[0.66rem] text-ink-faint">Illustrative data</span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden bg-pine-deep py-16 md:py-24">
        <Contour light />
        <motion.div
          initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }} transition={{ duration: 0.7 }}
          className="relative z-[1] mx-auto max-w-[44ch] px-6 text-center"
        >
          <h2 className="font-serif text-4xl tracking-tight text-paper text-balance md:text-5xl">
            Begin a <em className="italic text-harvest-soft">consistent, explainable</em> evaluation.
          </h2>
          <p className="mb-8 mt-4 text-lg text-paper/75">
            Sign in, upload a proposal, and read the verdict — the same rubric, every time.
          </p>
          <Link
            to="/register"
            className="inline-flex items-center gap-2 rounded-[2px] bg-paper px-7 py-3.5 font-mono text-base text-pine-deep transition-all duration-200 hover:-translate-y-0.5 hover:bg-white"
          >
            Create an account
            <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="bg-paper py-12">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-5 px-6 lg:px-10">
          <Brand />
          <small className="font-mono text-xs text-ink-faint">
            © 2026 AgriEval — AIAIC proposal evaluation portal · v{APP_VERSION} (beta)
          </small>
        </div>
      </footer>
    </div>
  );
}
