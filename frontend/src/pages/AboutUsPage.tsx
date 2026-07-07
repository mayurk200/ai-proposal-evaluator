import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useInView, type Variants } from 'framer-motion';
// NOTE: this lucide-react version has no brand icons (Twitter/GitHub/LinkedIn
// were removed upstream), so social links use generic Globe/Mail/Share2 icons.
import {
  ArrowRight, Award, BadgeCheck, Building2, Check, ChevronDown, ChevronLeft,
  ChevronRight, Code2, Cpu, Eye, Globe, Heart, Layers, Leaf, Lightbulb,
  Mail, Moon, Palette, Quote, Rocket, Send, Share2, ShieldCheck, Sparkles,
  Star, Sun, Target, TrendingUp, Trophy, Users, Zap, type LucideIcon,
} from 'lucide-react';

/**
 * About Us — standalone, full-length marketing page with its own design system.
 *
 * Deliberately self-contained: every color comes from `--au-*` CSS variables
 * set on the root element (indigo/violet palette, distinct from the app's
 * green theme) so light/dark mode toggles locally with no global theme
 * infrastructure. All imagery is composed from CSS/SVG — no stock photos.
 */

// ---- Design tokens (light / dark) ----

const LIGHT_TOKENS = {
  '--au-bg': '#F8FAFC',
  '--au-surface': '#FFFFFF',
  '--au-surface-2': '#F1F5F9',
  '--au-glass': 'rgba(255, 255, 255, 0.72)',
  '--au-text': '#0F172A',
  '--au-text-2': '#475569',
  '--au-muted': '#94A3B8',
  '--au-border': 'rgba(15, 23, 42, 0.08)',
  '--au-primary': '#4F46E5',
  '--au-secondary': '#7C3AED',
  '--au-accent': '#06B6D4',
  '--au-primary-soft': 'rgba(79, 70, 229, 0.08)',
  '--au-shadow': '0 1px 3px rgba(15, 23, 42, 0.04), 0 8px 32px rgba(79, 70, 229, 0.07)',
  '--au-shadow-lg': '0 4px 12px rgba(15, 23, 42, 0.06), 0 20px 48px rgba(79, 70, 229, 0.14)',
} as const;

const DARK_TOKENS: Record<keyof typeof LIGHT_TOKENS, string> = {
  '--au-bg': '#0B1120',
  '--au-surface': '#111A2E',
  '--au-surface-2': '#1E293B',
  '--au-glass': 'rgba(17, 26, 46, 0.72)',
  '--au-text': '#F1F5F9',
  '--au-text-2': '#A5B4CE',
  '--au-muted': '#64748B',
  '--au-border': 'rgba(148, 163, 184, 0.14)',
  '--au-primary': '#6366F1',
  '--au-secondary': '#8B5CF6',
  '--au-accent': '#22D3EE',
  '--au-primary-soft': 'rgba(99, 102, 241, 0.14)',
  '--au-shadow': '0 1px 3px rgba(0, 0, 0, 0.3), 0 8px 32px rgba(0, 0, 0, 0.35)',
  '--au-shadow-lg': '0 4px 12px rgba(0, 0, 0, 0.35), 0 20px 48px rgba(0, 0, 0, 0.5)',
};

// ---- Motion presets ----

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.6, ease: EASE },
  }),
};

const viewport = { once: true, margin: '-90px' } as const;

// ---- Shared building blocks ----

function Section({ id, className = '', children }: {
  id?: string; className?: string; children: React.ReactNode;
}) {
  // 120–160px vertical rhythm on desktop, tightened for small screens.
  return (
    <section id={id} className={`relative py-20 md:py-32 lg:py-36 ${className}`}>
      <div className="max-w-7xl mx-auto px-6">{children}</div>
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-[0.14em] bg-[var(--au-primary-soft)] text-[var(--au-primary)]">
      {children}
    </span>
  );
}

function SectionHeading({ eyebrow, title, description }: {
  eyebrow: string; title: React.ReactNode; description?: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      className="max-w-3xl mx-auto text-center mb-14 md:mb-20"
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-5 text-3xl md:text-5xl font-bold tracking-tight leading-[1.12] text-[var(--au-text)]">
        {title}
      </h2>
      {description && (
        <p className="mt-5 text-base md:text-lg text-[var(--au-text-2)] leading-relaxed">
          {description}
        </p>
      )}
    </motion.div>
  );
}

function GradientText({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-gradient-to-r from-[var(--au-primary)] via-[var(--au-secondary)] to-[var(--au-accent)] bg-clip-text text-transparent">
      {children}
    </span>
  );
}

function IconTile({ icon: Icon, size = 'md' }: { icon: LucideIcon; size?: 'md' | 'lg' }) {
  return (
    <div
      className={`${size === 'lg' ? 'w-14 h-14 rounded-2xl' : 'w-11 h-11 rounded-xl'} bg-gradient-to-br from-[var(--au-primary)] to-[var(--au-secondary)] flex items-center justify-center shadow-lg shadow-[var(--au-primary-soft)] flex-shrink-0`}
    >
      <Icon className={size === 'lg' ? 'w-7 h-7 text-white' : 'w-5 h-5 text-white'} />
    </div>
  );
}

const PRIMARY_BTN =
  'group inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-2xl text-sm font-semibold text-white ' +
  'bg-gradient-to-r from-[var(--au-primary)] to-[var(--au-secondary)] ' +
  'shadow-lg shadow-indigo-500/25 transition-all duration-300 ' +
  'hover:shadow-xl hover:shadow-indigo-500/35 hover:-translate-y-0.5 active:translate-y-0 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--au-primary)]';

const SECONDARY_BTN =
  'inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-2xl text-sm font-semibold ' +
  'text-[var(--au-text)] border border-[var(--au-border)] bg-[var(--au-glass)] backdrop-blur-xl ' +
  'transition-all duration-300 hover:border-[var(--au-primary)] hover:text-[var(--au-primary)] hover:-translate-y-0.5 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--au-primary)]';

/** Glassmorphism card with optional hover elevation. */
function GlassCard({ className = '', children, hover = true }: {
  className?: string; children: React.ReactNode; hover?: boolean;
}) {
  return (
    <div
      className={`rounded-3xl border border-[var(--au-border)] bg-[var(--au-glass)] backdrop-blur-xl [box-shadow:var(--au-shadow)] transition-all duration-300 ${
        hover ? 'hover:[box-shadow:var(--au-shadow-lg)] hover:-translate-y-1' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--au-primary)] to-[var(--au-secondary)] flex items-center justify-center">
        <Cpu className="w-5 h-5 text-white" />
      </span>
      <span className="text-xl font-bold tracking-tight text-[var(--au-text)]">
        Tech<GradientText>Nova</GradientText>
      </span>
    </span>
  );
}

/** Circular initials avatar on a per-person gradient (no stock photos). */
function Avatar({ name, gradient, size = 'md' }: {
  name: string; gradient: string; size?: 'sm' | 'md' | 'lg';
}) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  const sizes = {
    sm: 'w-12 h-12 text-base',
    md: 'w-14 h-14 text-lg',
    lg: 'w-28 h-28 text-3xl',
  };
  return (
    <div
      className={`${sizes[size]} rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center font-bold text-white ring-4 ring-[var(--au-surface)] flex-shrink-0`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

function SocialIcon({ icon: Icon, label, href = '#' }: {
  icon: LucideIcon; label: string; href?: string;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className="w-9 h-9 rounded-full border border-[var(--au-border)] bg-[var(--au-surface)] flex items-center justify-center text-[var(--au-text-2)] transition-all duration-300 hover:text-white hover:border-transparent hover:bg-gradient-to-br hover:from-[var(--au-primary)] hover:to-[var(--au-secondary)] hover:-translate-y-0.5"
    >
      <Icon className="w-4 h-4" />
    </a>
  );
}

// ---- Animated counter ----

function useCountUp(target: number, active: boolean, duration = 1800): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      // ease-out cubic so the count settles gently instead of stopping dead
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);
  return value;
}

// ---- Page content data ----

const NAV_LINKS = [
  { href: '#story', label: 'Story' },
  { href: '#values', label: 'Values' },
  { href: '#journey', label: 'Journey' },
  { href: '#team', label: 'Team' },
  { href: '#faq', label: 'FAQ' },
];

const VALUES = [
  { icon: Rocket, title: 'Innovation', desc: 'We chase hard problems and ship bold ideas before the industry catches up to them.' },
  { icon: ShieldCheck, title: 'Integrity', desc: 'Transparent pricing, honest timelines, and code we are proud to put our names on.' },
  { icon: Users, title: 'Collaboration', desc: 'Great software is a team sport — and our clients are always on the roster.' },
  { icon: Award, title: 'Excellence', desc: 'Details matter. We sweat the last five percent that turns good into exceptional.' },
  { icon: Heart, title: 'Customer First', desc: 'Every roadmap decision starts with one question: does this genuinely help our users?' },
  { icon: Leaf, title: 'Sustainability', desc: 'Efficient systems, green infrastructure, and technology built to last a decade.' },
  { icon: Lightbulb, title: 'Curiosity', desc: 'We budget real time for research, prototypes, and the questions nobody asked yet.' },
  { icon: Globe, title: 'Openness', desc: 'Open standards, open source contributions, and open conversations with our community.' },
];

const MILESTONES = [
  { year: '2014', title: 'Founded in a garage', desc: 'Two engineers, one whiteboard, and a conviction that enterprise software should feel effortless.', icon: Lightbulb, gradient: 'from-indigo-500 to-violet-500' },
  { year: '2016', title: 'First 100 clients', desc: 'Our consulting practice grew into a full product studio serving teams on three continents.', icon: Users, gradient: 'from-violet-500 to-fuchsia-500' },
  { year: '2019', title: 'Cloud platform launch', desc: 'Shipped our flagship SaaS platform — ten thousand users within the first six months.', icon: Rocket, gradient: 'from-fuchsia-500 to-pink-500' },
  { year: '2021', title: 'Series B & global expansion', desc: 'Opened offices in Singapore and Berlin; the team crossed one hundred people.', icon: Building2, gradient: 'from-cyan-500 to-blue-500' },
  { year: '2023', title: 'AI research division', desc: 'Founded an applied-AI lab focused on practical, human-centred machine intelligence.', icon: Sparkles, gradient: 'from-blue-500 to-indigo-500' },
  { year: '2026', title: '1,000 projects delivered', desc: 'A milestone that belongs to every client who trusted us with their vision.', icon: Trophy, gradient: 'from-indigo-500 to-purple-500' },
];

const STATS = [
  { icon: Heart, value: 500, suffix: '+', label: 'Clients Worldwide' },
  { icon: Users, value: 150, suffix: '+', label: 'Employees' },
  { icon: TrendingUp, value: 12, suffix: '', label: 'Years of Experience' },
  { icon: Globe, value: 30, suffix: '', label: 'Countries Served' },
  { icon: Layers, value: 1000, suffix: '+', label: 'Projects Delivered' },
  { icon: Star, value: 98, suffix: '%', label: 'Customer Satisfaction' },
];

const TEAM = [
  { name: 'Aarav Mehta', role: 'Co-Founder & CEO', bio: 'Ex-fintech architect. Believes the best strategy document is a working prototype.', gradient: 'from-indigo-500 to-violet-500' },
  { name: 'Sofia Almeida', role: 'Co-Founder & CTO', bio: 'Distributed-systems engineer who still reviews pull requests every Friday.', gradient: 'from-violet-500 to-fuchsia-500' },
  { name: 'Daniel Okafor', role: 'VP of Engineering', bio: 'Built platform teams at three unicorns. Obsessive about developer experience.', gradient: 'from-cyan-500 to-blue-500' },
  { name: 'Mei-Lin Zhang', role: 'Head of Design', bio: 'Design-systems specialist. Ships pixels and prose with the same care.', gradient: 'from-blue-500 to-indigo-500' },
  { name: 'Lucas Weber', role: 'Head of AI Research', bio: 'Former academic turned builder. Makes machine learning boringly reliable.', gradient: 'from-purple-500 to-pink-500' },
  { name: 'Amara Diallo', role: 'VP of Customer Success', bio: 'The reason our NPS survey has a fan club. Client partner for 200+ launches.', gradient: 'from-rose-500 to-orange-400' },
];

const CULTURE_TILES = [
  { icon: Code2, caption: 'Ship-it Fridays', detail: 'Every week ends with a demo, not a status meeting.', gradient: 'from-indigo-500 via-violet-500 to-purple-500', span: 'md:col-span-2 md:row-span-2' },
  { icon: Palette, caption: 'Design critiques', detail: 'Open to the whole company.', gradient: 'from-fuchsia-500 to-pink-500', span: '' },
  { icon: Globe, caption: 'Remote-first', detail: '30 countries, one culture.', gradient: 'from-cyan-500 to-blue-500', span: '' },
  { icon: Lightbulb, caption: 'Hack weeks', detail: 'Twice a year, zero roadmap.', gradient: 'from-amber-400 to-orange-500', span: '' },
  { icon: Heart, caption: 'Volunteer days', detail: 'Paid time for causes that matter.', gradient: 'from-emerald-500 to-teal-500', span: '' },
  { icon: Users, caption: 'Team summits', detail: 'The whole company, one city, every year.', gradient: 'from-blue-500 to-indigo-500', span: 'md:col-span-2' },
];

const BENEFITS = [
  { title: 'Senior teams only', desc: 'Every project is staffed with senior engineers and designers — no bait and switch.' },
  { title: 'Fixed, transparent pricing', desc: 'Scope, timeline, and cost agreed before the first sprint. No surprise invoices.' },
  { title: 'Production-grade from day one', desc: 'CI/CD, observability, and security reviews are built in, not bolted on.' },
  { title: 'You own everything', desc: 'Code, infrastructure, and documentation are yours — no vendor lock-in, ever.' },
  { title: 'Weekly shippable demos', desc: 'Progress you can click, every single week, from kickoff to launch.' },
  { title: '24/7 post-launch support', desc: 'A named team that answers in minutes, backed by a 99.98% uptime record.' },
];

const AWARD_LOGOS = ['TechCrunch', 'Forbes Cloud 100', 'Gartner', 'Product Hunt', 'FastCompany', 'Wired'];

const AWARDS = [
  { icon: Trophy, title: 'SaaS Product of the Year', org: 'Global Tech Awards · 2024', desc: 'Recognised for our flagship cloud platform and its record-setting adoption curve.' },
  { icon: BadgeCheck, title: 'ISO 27001 & SOC 2 Type II', org: 'Certified since 2020', desc: 'Independently audited security and availability controls, renewed every year.' },
  { icon: Award, title: 'Best Place to Work in Tech', org: 'CultureFirst Index · 2025', desc: 'Ranked in the top ten for growth, wellbeing, and employee-led innovation.' },
];

const TESTIMONIALS = [
  {
    quote: 'TechNova rebuilt our entire data platform in four months. The craftsmanship, the communication, the calm under pressure — unlike any vendor we have ever worked with.',
    name: 'Elena Petrova',
    role: 'CTO',
    company: 'Northwind Logistics',
    gradient: 'from-rose-500 to-orange-400',
    rating: 5,
  },
  {
    quote: 'They think like product owners, not contractors. Every sprint ended with something our customers could actually touch, and our activation rate doubled within a quarter.',
    name: 'Marcus Bell',
    role: 'VP Product',
    company: 'Finlay & Co.',
    gradient: 'from-emerald-500 to-teal-400',
    rating: 5,
  },
  {
    quote: 'From the first workshop to launch day, the team felt like an extension of ours. We have signed on for three more years — the easiest renewal decision we have made.',
    name: 'Yuki Tanaka',
    role: 'Head of Digital',
    company: 'Hoshino Health',
    gradient: 'from-sky-500 to-indigo-400',
    rating: 5,
  },
];

const FAQS = [
  { q: 'What kind of companies do you work with?', a: 'Everyone from seed-stage startups to Fortune 500 enterprises. What our clients share is ambition: a product that matters, a deadline that is real, and a bar for quality that most vendors will not commit to.' },
  { q: 'How do projects typically start?', a: 'With a one-week discovery sprint. We map your users, systems, and constraints, then deliver a concrete proposal — architecture, team, timeline, and a fixed price. You keep the discovery artifacts whether or not we continue together.' },
  { q: 'Do you work with existing in-house teams?', a: 'Constantly — about half of our engagements are embedded. We plug senior engineers and designers into your rituals, your repos, and your standups, and we measure ourselves by how much faster your team ships.' },
  { q: 'What technologies do you specialise in?', a: 'TypeScript, React, and Node on the product side; Python for AI and data systems; and the major clouds (AWS, GCP, Azure) for infrastructure. We are pragmatic: we choose the stack your team can own, not the one that is fashionable.' },
  { q: 'How do you price your work?', a: 'Fixed price per clearly-scoped phase, agreed before the phase begins. No hourly billing, no surprise invoices. If we mis-estimate, that is our cost — not yours.' },
  { q: 'Who owns the code and IP?', a: 'You do, in full, from the first commit. Code, infrastructure definitions, design files, and documentation live in your accounts. There is no lock-in by design.' },
  { q: 'What happens after launch?', a: 'Every project ships with a 90-day stabilisation window included. After that, most clients keep a named support team on retainer — with response times measured in minutes, backed by our 99.98% uptime record.' },
];

const FOOTER_COLUMNS = [
  {
    title: 'Company',
    links: [
      { label: 'About Us', to: '/about-us' },
      { label: 'Careers', to: '#' },
      { label: 'Press Kit', to: '#' },
      { label: 'Contact', to: '#contact' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Platform Docs', to: '/about' },
      { label: 'Dashboard', to: '/dashboard' },
      { label: 'Case Studies', to: '#' },
      { label: 'Blog', to: '#' },
    ],
  },
];

// ---- 1. Navbar + Hero ----

function Navbar({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--au-border)] bg-[var(--au-glass)] backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/about-us" aria-label="TechNova home"><Logo /></Link>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[var(--au-text-2)]">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-[var(--au-primary)] transition-colors">
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleDark}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-9 h-9 rounded-xl border border-[var(--au-border)] bg-[var(--au-surface)] flex items-center justify-center text-[var(--au-text-2)] hover:text-[var(--au-primary)] transition-colors"
          >
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <a
            href="#contact"
            className="hidden sm:inline-flex px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-[var(--au-primary)] to-[var(--au-secondary)] shadow-md shadow-indigo-500/20 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
          >
            Contact Us
          </a>
        </div>
      </div>
    </nav>
  );
}

/** Abstract "3D" hero graphic built from layered gradients and glass tiles. */
function HeroGraphic() {
  return (
    <div className="relative h-[380px] md:h-[520px]" aria-hidden="true">
      <div className="absolute top-6 right-8 w-72 h-72 rounded-full bg-[var(--au-primary)] opacity-20 blur-3xl" />
      <div className="absolute bottom-4 left-4 w-60 h-60 rounded-full bg-[var(--au-accent)] opacity-20 blur-3xl" />

      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 46, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-x-6 inset-y-2 rounded-full border-2 border-dashed border-[var(--au-primary)] opacity-20"
      />
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 70, repeat: Infinity, ease: 'linear' }}
        className="absolute inset-x-16 inset-y-12 rounded-full border border-[var(--au-secondary)] opacity-15"
      />

      {/* main glass panel: a stylized product dashboard */}
      <motion.div
        initial={{ opacity: 0, y: 48, rotate: -2 }}
        animate={{ opacity: 1, y: 0, rotate: -2 }}
        transition={{ duration: 0.8, delay: 0.25, ease: EASE }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-72 md:w-96 rounded-[28px] border border-[var(--au-border)] bg-[var(--au-glass)] backdrop-blur-xl [box-shadow:var(--au-shadow-lg)] p-6"
      >
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="mt-5 h-28 md:h-32 rounded-2xl bg-gradient-to-br from-[var(--au-primary)] via-[var(--au-secondary)] to-[var(--au-accent)] opacity-90 relative overflow-hidden">
          {/* fake sparkline */}
          <svg viewBox="0 0 200 60" className="absolute inset-x-0 bottom-0 w-full h-2/3 text-white/70" preserveAspectRatio="none">
            <path d="M0,50 C30,42 45,20 70,26 S110,52 135,38 S175,8 200,14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="mt-5 space-y-3">
          <div className="h-2.5 rounded-full bg-[var(--au-surface-2)] w-3/4" />
          <div className="h-2.5 rounded-full bg-[var(--au-surface-2)] w-1/2" />
          <div className="h-2.5 rounded-full bg-[var(--au-surface-2)] w-2/3" />
        </div>
      </motion.div>

      {/* floating glass chips */}
      <motion.div
        animate={{ y: [0, -14, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-10 left-0 md:left-6 rounded-2xl border border-[var(--au-border)] bg-[var(--au-glass)] backdrop-blur-xl [box-shadow:var(--au-shadow)] px-4 py-3 flex items-center gap-3"
      >
        <IconTile icon={Zap} />
        <div>
          <p className="text-xs font-semibold text-[var(--au-text)]">99.98% uptime</p>
          <p className="text-[11px] text-[var(--au-muted)]">last 12 months</p>
        </div>
      </motion.div>
      <motion.div
        animate={{ y: [0, 14, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
        className="absolute bottom-10 right-0 md:right-2 rounded-2xl border border-[var(--au-border)] bg-[var(--au-glass)] backdrop-blur-xl [box-shadow:var(--au-shadow)] px-4 py-3 flex items-center gap-3"
      >
        <IconTile icon={Sparkles} />
        <div>
          <p className="text-xs font-semibold text-[var(--au-text)]">AI-assisted delivery</p>
          <p className="text-[11px] text-[var(--au-muted)]">ship 2× faster</p>
        </div>
      </motion.div>
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 1.6 }}
        className="hidden md:flex absolute top-1/2 -right-2 rounded-2xl border border-[var(--au-border)] bg-[var(--au-glass)] backdrop-blur-xl [box-shadow:var(--au-shadow)] px-4 py-3 items-center gap-3"
      >
        <IconTile icon={Globe} />
        <div>
          <p className="text-xs font-semibold text-[var(--au-text)]">30 countries</p>
          <p className="text-[11px] text-[var(--au-muted)]">one team</p>
        </div>
      </motion.div>
    </div>
  );
}

function Hero() {
  return (
    <header className="relative min-h-screen flex items-center overflow-hidden pt-16">
      {/* gradient wash + decorative orbs */}
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--au-primary-soft)] via-transparent to-transparent" aria-hidden="true" />
      <div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-[var(--au-secondary)] opacity-[0.07] blur-3xl" aria-hidden="true" />
      <div className="absolute top-1/3 -right-40 w-[520px] h-[520px] rounded-full bg-[var(--au-accent)] opacity-[0.07] blur-3xl" aria-hidden="true" />

      <div className="relative max-w-7xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-14 items-center w-full">
        <div>
          <motion.div variants={fadeUp} initial="hidden" animate="visible">
            <Eyebrow><Sparkles className="w-3.5 h-3.5" /> About TechNova</Eyebrow>
          </motion.div>
          <motion.h1
            variants={fadeUp}
            custom={1}
            initial="hidden"
            animate="visible"
            className="mt-6 text-5xl md:text-6xl xl:text-7xl font-bold tracking-tight leading-[1.05] text-[var(--au-text)]"
          >
            Building the Future with <GradientText>Technology</GradientText>
          </motion.h1>
          <motion.p
            variants={fadeUp}
            custom={2}
            initial="hidden"
            animate="visible"
            className="mt-7 text-lg md:text-xl text-[var(--au-text-2)] leading-relaxed max-w-xl"
          >
            We are a product and engineering company helping ambitious teams design,
            build, and scale software people love — from AI platforms to cloud
            infrastructure trusted by five hundred companies in thirty countries.
          </motion.p>
          <motion.div
            variants={fadeUp}
            custom={3}
            initial="hidden"
            animate="visible"
            className="mt-10 flex flex-col sm:flex-row gap-4"
          >
            <a href="#story" className={PRIMARY_BTN}>
              Learn More
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
            <a href="#contact" className={SECONDARY_BTN}>Talk to Us</a>
          </motion.div>
          {/* social proof strip */}
          <motion.div
            variants={fadeUp}
            custom={4}
            initial="hidden"
            animate="visible"
            className="mt-12 flex items-center gap-4"
          >
            <div className="flex -space-x-3">
              {TEAM.slice(0, 4).map((m) => (
                <div key={m.name} className={`w-9 h-9 rounded-full bg-gradient-to-br ${m.gradient} ring-2 ring-[var(--au-bg)] flex items-center justify-center text-[10px] font-bold text-white`} aria-hidden="true">
                  {m.name.split(' ').map((w) => w[0]).join('')}
                </div>
              ))}
            </div>
            <p className="text-sm text-[var(--au-text-2)]">
              <span className="font-semibold text-[var(--au-text)]">150+ specialists</span> across 30 countries
            </p>
          </motion.div>
        </div>
        <HeroGraphic />
      </div>

      {/* scroll cue */}
      <motion.a
        href="#story"
        aria-label="Scroll to our story"
        animate={{ y: [0, 8, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[var(--au-muted)] hover:text-[var(--au-primary)] transition-colors"
      >
        <ChevronDown className="w-6 h-6" />
      </motion.a>
    </header>
  );
}

// ---- 2. Company introduction ----

function StoryVisual() {
  return (
    <motion.div
      variants={fadeUp}
      custom={1}
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      className="relative"
      aria-hidden="true"
    >
      <div className="absolute -top-8 -right-8 w-40 h-40 rounded-[28px] bg-[var(--au-primary-soft)] rotate-12" />
      <div className="relative rounded-[28px] overflow-hidden [box-shadow:var(--au-shadow-lg)] aspect-[4/3] bg-gradient-to-br from-[var(--au-primary)] via-[var(--au-secondary)] to-[var(--au-accent)]">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/20 blur-2xl" />
        <div className="absolute bottom-6 left-6 right-6 rounded-2xl bg-white/15 backdrop-blur-md border border-white/25 p-5 text-white">
          <p className="text-sm font-semibold">From two desks to three continents</p>
          <p className="text-xs mt-1 text-white/80">
            The same first principle since day one: build it as if we had to run it forever.
          </p>
        </div>
      </div>
      <div className="absolute -bottom-6 -left-6 rounded-2xl border border-[var(--au-border)] bg-[var(--au-glass)] backdrop-blur-xl [box-shadow:var(--au-shadow)] px-5 py-4 flex items-center gap-3">
        <IconTile icon={Rocket} />
        <div>
          <p className="text-sm font-bold text-[var(--au-text)]">Est. 2014</p>
          <p className="text-xs text-[var(--au-muted)]">and still shipping</p>
        </div>
      </div>
    </motion.div>
  );
}

function OurStory() {
  return (
    <Section id="story">
      <div className="grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">
        <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewport}>
          <Eyebrow>Our Story</Eyebrow>
          <h2 className="mt-5 text-3xl md:text-5xl font-bold tracking-tight leading-[1.12] text-[var(--au-text)]">
            Twelve years of turning bold ideas into shipped products
          </h2>
          <div className="mt-7 space-y-5 text-[var(--au-text-2)] leading-relaxed text-base md:text-lg">
            <p>
              TechNova began in 2014 with two engineers, a rented garage, and a
              simple frustration: enterprise software didn&rsquo;t have to feel like
              enterprise software. Our first client was a local logistics firm;
              our first product cut their dispatch time in half.
            </p>
            <p>
              Word travelled. The garage became an office, the duo became a
              studio, and the studio became a company of one hundred and fifty
              designers, engineers, and researchers across thirty countries —
              still small enough to care about every commit, large enough to
              take on platforms used by millions.
            </p>
            <p>
              Today we build AI systems, cloud platforms, and digital products
              for more than five hundred clients. The tools have changed; the
              principle hasn&rsquo;t: technology should quietly make people&rsquo;s work —
              and lives — better.
            </p>
          </div>
        </motion.div>
        <StoryVisual />
      </div>
    </Section>
  );
}

// ---- 3. Mission & Vision ----

function MissionVision() {
  const cards = [
    {
      icon: Target,
      title: 'Our Mission',
      desc: 'To make world-class software accessible to every ambitious team — pairing rigorous engineering with human-centred design so technology serves people, never the other way around.',
    },
    {
      icon: Eye,
      title: 'Our Vision',
      desc: 'A world where intelligent software amplifies human potential: where the best tools are also the most trustworthy, the most sustainable, and the most delightful to use.',
    },
  ];
  return (
    <Section id="mission" className="bg-[var(--au-surface-2)]/50">
      <SectionHeading
        eyebrow="Purpose"
        title="Mission & Vision"
        description="The two sentences every project, hire, and roadmap decision is measured against."
      />
      <div className="grid md:grid-cols-2 gap-6 lg:gap-8 max-w-5xl mx-auto">
        {cards.map((c, i) => (
          <motion.div key={c.title} variants={fadeUp} custom={i} initial="hidden" whileInView="visible" viewport={viewport}>
            <GlassCard className="p-10 lg:p-12 h-full">
              <IconTile icon={c.icon} size="lg" />
              <h3 className="mt-6 text-2xl font-bold text-[var(--au-text)]">{c.title}</h3>
              <p className="mt-4 text-base leading-relaxed text-[var(--au-text-2)]">{c.desc}</p>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

// ---- 4. Core values (gradient-border cards) ----

function CoreValues() {
  return (
    <Section id="values">
      <SectionHeading
        eyebrow="Culture"
        title={<>The values we hire, build, and <GradientText>ship</GradientText> by</>}
        description="Eight commitments that show up in our code reviews as often as our contracts."
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
        {VALUES.map((v, i) => (
          <motion.div key={v.title} variants={fadeUp} custom={i % 4} initial="hidden" whileInView="visible" viewport={viewport}>
            {/* gradient border via padded wrapper */}
            <div className="group h-full rounded-3xl p-px bg-gradient-to-br from-[var(--au-border)] to-[var(--au-border)] hover:from-[var(--au-primary)] hover:via-[var(--au-secondary)] hover:to-[var(--au-accent)] transition-all duration-300 hover:-translate-y-1">
              <div className="h-full rounded-[calc(1.5rem-1px)] bg-[var(--au-surface)] p-7 transition-shadow duration-300 group-hover:[box-shadow:var(--au-shadow-lg)]">
                <div className="w-12 h-12 rounded-2xl bg-[var(--au-primary-soft)] flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:bg-gradient-to-br group-hover:from-[var(--au-primary)] group-hover:to-[var(--au-secondary)]">
                  <v.icon className="w-6 h-6 text-[var(--au-primary)] transition-colors duration-300 group-hover:text-white" />
                </div>
                <h3 className="mt-5 text-lg font-bold text-[var(--au-text)]">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--au-text-2)]">{v.desc}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

// ---- 5. Journey timeline ----

function Timeline() {
  return (
    <Section id="journey" className="bg-[var(--au-surface-2)]/50">
      <SectionHeading
        eyebrow="Journey"
        title="Milestones along the way"
        description="Twelve years, compressed into the moments that changed us."
      />
      <div className="relative max-w-3xl mx-auto">
        <div
          className="absolute left-[19px] md:left-1/2 md:-translate-x-1/2 top-2 bottom-2 w-0.5 bg-gradient-to-b from-[var(--au-primary)] via-[var(--au-secondary)] to-[var(--au-accent)] opacity-40"
          aria-hidden="true"
        />
        <ol className="space-y-10 md:space-y-14">
          {MILESTONES.map((m, i) => {
            const left = i % 2 === 0;
            return (
              <motion.li
                key={m.year}
                initial={{ opacity: 0, x: left ? -32 : 32 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={viewport}
                transition={{ duration: 0.55, ease: EASE }}
                className={`relative pl-14 md:pl-0 md:w-[calc(50%-2.5rem)] ${left ? 'md:mr-auto' : 'md:ml-auto'}`}
              >
                {/* node on the rail */}
                <span
                  className={`absolute top-2 left-0 md:left-auto ${left ? 'md:-right-[4.05rem]' : 'md:-left-[4.05rem]'} w-10 h-10 rounded-full bg-gradient-to-br from-[var(--au-primary)] to-[var(--au-secondary)] ring-4 ring-[var(--au-bg)] flex items-center justify-center`}
                  aria-hidden="true"
                >
                  <m.icon className="w-[18px] h-[18px] text-white" />
                </span>
                <GlassCard className="overflow-hidden">
                  {/* milestone "image": gradient art band */}
                  <div className={`h-24 bg-gradient-to-br ${m.gradient} relative`} aria-hidden="true">
                    <div className="absolute inset-0 opacity-25" style={{ backgroundImage: 'radial-gradient(circle at 20% 40%, rgba(255,255,255,0.5) 0, transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.35) 0, transparent 45%)' }} />
                    <span className="absolute bottom-3 left-5 text-3xl font-bold text-white/90 tracking-tight">{m.year}</span>
                  </div>
                  <div className="p-6">
                    <h3 className="text-base font-bold text-[var(--au-text)]">{m.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--au-text-2)]">{m.desc}</p>
                  </div>
                </GlassCard>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </Section>
  );
}

// ---- 6. Statistics ----

function StatCounter({ icon: Icon, value, suffix, label, index }: {
  icon: LucideIcon; value: number; suffix: string; label: string; index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const count = useCountUp(value, inView);
  return (
    <motion.div ref={ref} variants={fadeUp} custom={index % 3} initial="hidden" whileInView="visible" viewport={viewport}>
      <GlassCard className="p-8 lg:p-10 text-center h-full">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-[var(--au-primary-soft)] flex items-center justify-center">
          <Icon className="w-6 h-6 text-[var(--au-primary)]" />
        </div>
        <p className="mt-5 text-4xl lg:text-5xl font-bold tracking-tight text-[var(--au-text)] tabular-nums">
          {count.toLocaleString()}
          <span className="text-[var(--au-primary)]">{suffix}</span>
        </p>
        <p className="mt-2 text-sm font-medium text-[var(--au-text-2)]">{label}</p>
      </GlassCard>
    </motion.div>
  );
}

function Stats() {
  return (
    <Section id="stats">
      <SectionHeading
        eyebrow="By the numbers"
        title="Momentum you can measure"
        description="A decade of compounding trust, in six numbers."
      />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {STATS.map((s, i) => (
          <StatCounter key={s.label} {...s} index={i} />
        ))}
      </div>
    </Section>
  );
}

// ---- 7. Team ----

function Team() {
  return (
    <Section id="team" className="bg-[var(--au-surface-2)]/50">
      <SectionHeading
        eyebrow="People"
        title="Meet the Team"
        description="The leadership behind five hundred client partnerships — and the hundred and fifty specialists beside them."
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
        {TEAM.map((m, i) => (
          <motion.div key={m.name} variants={fadeUp} custom={i % 3} initial="hidden" whileInView="visible" viewport={viewport}>
            <GlassCard className="p-8 text-center h-full flex flex-col items-center">
              <Avatar name={m.name} gradient={m.gradient} size="lg" />
              <h3 className="mt-6 text-lg font-bold text-[var(--au-text)]">{m.name}</h3>
              <p className="mt-1 text-sm text-[var(--au-primary)] font-semibold">{m.role}</p>
              <p className="mt-3 text-sm leading-relaxed text-[var(--au-text-2)] flex-1">{m.bio}</p>
              <div className="mt-5 flex justify-center gap-2">
                <SocialIcon icon={Globe} label={`${m.name}'s website`} />
                <SocialIcon icon={Mail} label={`Email ${m.name}`} />
                <SocialIcon icon={Share2} label={`${m.name}'s social profiles`} />
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

// ---- 8. Culture bento gallery ----

function Culture() {
  return (
    <Section id="culture">
      <SectionHeading
        eyebrow="Life at TechNova"
        title="Culture, not perks"
        description="The habits that make fifty releases a year feel calm."
      />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-5 md:auto-rows-[180px]">
        {CULTURE_TILES.map((t, i) => (
          <motion.div
            key={t.caption}
            variants={fadeUp}
            custom={i % 4}
            initial="hidden"
            whileInView="visible"
            viewport={viewport}
            className={t.span}
          >
            <div className={`group relative h-full min-h-[180px] rounded-3xl overflow-hidden bg-gradient-to-br ${t.gradient} [box-shadow:var(--au-shadow)] transition-all duration-300 hover:[box-shadow:var(--au-shadow-lg)] hover:-translate-y-1`}>
              {/* texture */}
              <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(255,255,255,0.55) 0, transparent 45%), radial-gradient(circle at 80% 75%, rgba(255,255,255,0.35) 0, transparent 50%)' }} aria-hidden="true" />
              <t.icon className="absolute top-5 left-5 w-7 h-7 text-white/90" aria-hidden="true" />
              {/* caption */}
              <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/45 to-transparent">
                <p className="text-sm font-bold text-white">{t.caption}</p>
                <p className="text-xs text-white/80 mt-0.5">{t.detail}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

// ---- 9. Why choose us ----

/** Stylized product dashboard mockup (pure CSS/SVG). */
function DashboardMockup() {
  const bars = [42, 68, 55, 80, 62, 92, 74];
  return (
    <motion.div
      variants={fadeUp}
      custom={1}
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      className="relative"
      aria-hidden="true"
    >
      <div className="absolute -inset-6 rounded-[32px] bg-gradient-to-br from-[var(--au-primary)] to-[var(--au-accent)] opacity-10 blur-2xl" />
      <div className="relative rounded-[28px] border border-[var(--au-border)] bg-[var(--au-glass)] backdrop-blur-xl [box-shadow:var(--au-shadow-lg)] overflow-hidden">
        {/* window chrome */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[var(--au-border)]">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <span className="ml-3 h-5 w-40 rounded-md bg-[var(--au-surface-2)]" />
        </div>
        <div className="p-6 space-y-5">
          {/* stat row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Revenue', val: '$2.4M', up: '+18%' },
              { label: 'Active users', val: '48.2K', up: '+12%' },
              { label: 'NPS', val: '72', up: '+6' },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-[var(--au-border)] bg-[var(--au-surface)] p-4">
                <p className="text-[11px] text-[var(--au-muted)]">{s.label}</p>
                <p className="text-lg font-bold text-[var(--au-text)] mt-0.5">{s.val}</p>
                <p className="text-[11px] font-semibold text-emerald-500">{s.up}</p>
              </div>
            ))}
          </div>
          {/* bar chart */}
          <div className="rounded-2xl border border-[var(--au-border)] bg-[var(--au-surface)] p-5">
            <div className="flex items-end gap-3 h-32">
              {bars.map((h, i) => (
                <motion.div
                  key={i}
                  initial={{ height: 0 }}
                  whileInView={{ height: `${h}%` }}
                  viewport={viewport}
                  transition={{ duration: 0.7, delay: 0.25 + i * 0.07, ease: EASE }}
                  className={`flex-1 rounded-t-lg ${i === 5 ? 'bg-gradient-to-t from-[var(--au-primary)] to-[var(--au-secondary)]' : 'bg-[var(--au-primary-soft)]'}`}
                />
              ))}
            </div>
          </div>
          {/* rows */}
          <div className="space-y-2.5">
            <div className="h-2.5 rounded-full bg-[var(--au-surface-2)] w-2/3" />
            <div className="h-2.5 rounded-full bg-[var(--au-surface-2)] w-1/2" />
          </div>
        </div>
      </div>
      {/* floating badge */}
      <div className="absolute -bottom-5 -right-4 rounded-2xl border border-[var(--au-border)] bg-[var(--au-glass)] backdrop-blur-xl [box-shadow:var(--au-shadow)] px-4 py-3 flex items-center gap-3">
        <IconTile icon={TrendingUp} />
        <div>
          <p className="text-xs font-bold text-[var(--au-text)]">2× faster delivery</p>
          <p className="text-[11px] text-[var(--au-muted)]">measured across 1,000 projects</p>
        </div>
      </div>
    </motion.div>
  );
}

function WhyChooseUs() {
  return (
    <Section id="why-us" className="bg-[var(--au-surface-2)]/50">
      <div className="grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">
        <motion.div variants={fadeUp} initial="hidden" whileInView="visible" viewport={viewport}>
          <Eyebrow>Why Choose Us</Eyebrow>
          <h2 className="mt-5 text-3xl md:text-5xl font-bold tracking-tight leading-[1.12] text-[var(--au-text)]">
            Six promises we put in every contract
          </h2>
          <ul className="mt-9 space-y-5">
            {BENEFITS.map((b, i) => (
              <motion.li
                key={b.title}
                variants={fadeUp}
                custom={i * 0.6}
                initial="hidden"
                whileInView="visible"
                viewport={viewport}
                className="flex items-start gap-4"
              >
                <span className="mt-0.5 w-7 h-7 rounded-full bg-gradient-to-br from-[var(--au-primary)] to-[var(--au-secondary)] flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4 text-white" strokeWidth={3} />
                </span>
                <div>
                  <p className="text-base font-semibold text-[var(--au-text)]">{b.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--au-text-2)]">{b.desc}</p>
                </div>
              </motion.li>
            ))}
          </ul>
        </motion.div>
        <DashboardMockup />
      </div>
    </Section>
  );
}

// ---- 10. Awards & recognition ----

function AwardsSection() {
  return (
    <Section id="awards">
      <SectionHeading
        eyebrow="Recognition"
        title="Awards & Recognition"
        description="Nice to have. Never the point — but our teams earned them, so we hang them."
      />
      {/* press / logo wall */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 mb-16"
        aria-label="Featured in"
      >
        {AWARD_LOGOS.map((l) => (
          <span
            key={l}
            className="text-lg md:text-xl font-bold tracking-tight text-[var(--au-muted)] opacity-70 hover:opacity-100 hover:text-[var(--au-primary)] transition-all duration-300 select-none"
          >
            {l}
          </span>
        ))}
      </motion.div>
      <div className="grid md:grid-cols-3 gap-6">
        {AWARDS.map((a, i) => (
          <motion.div key={a.title} variants={fadeUp} custom={i} initial="hidden" whileInView="visible" viewport={viewport}>
            <GlassCard className="p-8 h-full">
              <IconTile icon={a.icon} size="lg" />
              <h3 className="mt-5 text-lg font-bold text-[var(--au-text)]">{a.title}</h3>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--au-primary)]">{a.org}</p>
              <p className="mt-3 text-sm leading-relaxed text-[var(--au-text-2)]">{a.desc}</p>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

// ---- 11. Testimonial carousel ----

function Testimonials() {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const t = TESTIMONIALS[index];

  const go = (dir: number) => {
    setDirection(dir);
    setIndex((i) => (i + dir + TESTIMONIALS.length) % TESTIMONIALS.length);
  };

  return (
    <Section id="testimonials" className="bg-[var(--au-surface-2)]/50">
      <SectionHeading
        eyebrow="Testimonials"
        title="What our partners say"
        description="Long-term relationships are our favourite metric."
      />
      <div className="max-w-3xl mx-auto">
        <div className="relative overflow-hidden">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.figure
              key={index}
              custom={direction}
              initial={{ opacity: 0, x: direction * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -60 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              <GlassCard hover={false} className="p-10 md:p-14 text-center">
                <Quote className="w-10 h-10 text-[var(--au-primary)] opacity-40 mx-auto" aria-hidden="true" />
                <div className="mt-4 flex items-center justify-center gap-1" aria-label={`${t.rating} out of 5 stars`}>
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 text-amber-400 fill-amber-400" aria-hidden="true" />
                  ))}
                </div>
                <blockquote className="mt-6 text-lg md:text-xl leading-relaxed text-[var(--au-text)]">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-8 flex items-center justify-center gap-4">
                  <Avatar name={t.name} gradient={t.gradient} />
                  <div className="text-left">
                    <p className="text-sm font-bold text-[var(--au-text)]">{t.name}</p>
                    <p className="text-xs text-[var(--au-muted)]">{t.role} · {t.company}</p>
                  </div>
                </figcaption>
              </GlassCard>
            </motion.figure>
          </AnimatePresence>
        </div>
        {/* controls */}
        <div className="mt-8 flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous testimonial"
            className="w-11 h-11 rounded-full border border-[var(--au-border)] bg-[var(--au-surface)] flex items-center justify-center text-[var(--au-text-2)] transition-all duration-300 hover:text-white hover:border-transparent hover:bg-gradient-to-br hover:from-[var(--au-primary)] hover:to-[var(--au-secondary)]"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2" role="tablist" aria-label="Testimonials">
            {TESTIMONIALS.map((item, i) => (
              <button
                key={item.name}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Testimonial from ${item.name}`}
                onClick={() => { setDirection(i > index ? 1 : -1); setIndex(i); }}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === index ? 'w-8 bg-gradient-to-r from-[var(--au-primary)] to-[var(--au-secondary)]' : 'w-2 bg-[var(--au-border)] hover:bg-[var(--au-muted)]'
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next testimonial"
            className="w-11 h-11 rounded-full border border-[var(--au-border)] bg-[var(--au-surface)] flex items-center justify-center text-[var(--au-text-2)] transition-all duration-300 hover:text-white hover:border-transparent hover:bg-gradient-to-br hover:from-[var(--au-primary)] hover:to-[var(--au-secondary)]"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </Section>
  );
}

// ---- 12. FAQ accordion ----

function FaqItem({ q, a, open, onToggle }: {
  q: string; a: string; open: boolean; onToggle: () => void;
}) {
  return (
    <GlassCard hover={false} className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-7 py-5 text-left"
      >
        <span className="text-base font-semibold text-[var(--au-text)]">{q}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-300 ${
            open ? 'bg-gradient-to-br from-[var(--au-primary)] to-[var(--au-secondary)] text-white' : 'bg-[var(--au-primary-soft)] text-[var(--au-primary)]'
          }`}
          aria-hidden="true"
        >
          <ChevronDown className="w-4 h-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <p className="px-7 pb-6 text-sm md:text-base leading-relaxed text-[var(--au-text-2)]">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  return (
    <Section id="faq">
      <SectionHeading
        eyebrow="FAQ"
        title="Questions, answered"
        description="Everything prospective partners usually ask in the first call."
      />
      <div className="max-w-3xl mx-auto space-y-4">
        {FAQS.map((f, i) => (
          <motion.div key={f.q} variants={fadeUp} custom={i * 0.4} initial="hidden" whileInView="visible" viewport={viewport}>
            <FaqItem
              q={f.q}
              a={f.a}
              open={openIndex === i}
              onToggle={() => setOpenIndex((cur) => (cur === i ? null : i))}
            />
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

// ---- 13. Call to action ----

function CallToAction() {
  return (
    <Section id="contact">
      <motion.div
        variants={fadeUp}
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
        className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[var(--au-primary)] via-[var(--au-secondary)] to-[var(--au-accent)] px-8 py-20 md:px-16 md:py-28 text-center [box-shadow:var(--au-shadow-lg)]"
      >
        <div className="absolute -top-16 -left-16 w-72 h-72 rounded-full bg-white/15 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-24 -right-10 w-80 h-80 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '40px 40px' }} aria-hidden="true" />
        <h2 className="relative text-3xl md:text-6xl font-bold tracking-tight text-white leading-[1.1]">
          Let&rsquo;s Build Something Amazing Together
        </h2>
        <p className="relative mt-6 text-white/85 max-w-2xl mx-auto text-base md:text-xl">
          Tell us about your product, your users, and your deadline. We&rsquo;ll bring
          the team that ships it.
        </p>
        <div className="relative mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="mailto:hello@technova.example"
            className="group inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-sm font-bold text-[var(--au-primary)] bg-white shadow-xl shadow-black/10 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl"
          >
            Contact Us
            <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
          </a>
          <a
            href="#story"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-sm font-bold text-white border border-white/40 bg-white/10 backdrop-blur-md transition-all duration-300 hover:bg-white/20 hover:-translate-y-0.5"
          >
            Read Our Story
          </a>
        </div>
      </motion.div>
    </Section>
  );
}

// ---- 14. Footer ----

function NewsletterForm() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim()) setDone(true);
      }}
      aria-label="Newsletter signup"
    >
      <p className="text-sm font-bold text-[var(--au-text)] uppercase tracking-wider">Stay in the loop</p>
      <p className="mt-2 text-sm text-[var(--au-text-2)]">
        One email a month: what we shipped, what we learned.
      </p>
      {done ? (
        <p className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-500">
          <BadgeCheck className="w-4 h-4" /> You&rsquo;re subscribed — see you next month.
        </p>
      ) : (
        <div className="mt-4 flex gap-2">
          <label htmlFor="newsletter-email" className="sr-only">Email address</label>
          <input
            id="newsletter-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="flex-1 min-w-0 px-4 py-2.5 rounded-xl text-sm bg-[var(--au-surface)] border border-[var(--au-border)] text-[var(--au-text)] placeholder:text-[var(--au-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--au-primary)]/40"
          />
          <button
            type="submit"
            aria-label="Subscribe"
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[var(--au-primary)] to-[var(--au-secondary)] text-white transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-0.5"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}
    </form>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--au-border)] bg-[var(--au-surface)]/60 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 pt-16 pb-10">
        <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4">
          {/* company info */}
          <div>
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-[var(--au-text-2)] max-w-xs">
              A product and engineering company building software people love —
              since 2014, across thirty countries.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <SocialIcon icon={Globe} label="TechNova website" />
              <SocialIcon icon={Mail} label="Email TechNova" />
              <SocialIcon icon={Share2} label="TechNova social profiles" />
            </div>
          </div>
          {/* link columns */}
          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="text-sm font-bold text-[var(--au-text)] uppercase tracking-wider">{col.title}</p>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.to.startsWith('#') || l.to === '#' ? (
                      <a href={l.to} className="text-sm text-[var(--au-text-2)] hover:text-[var(--au-primary)] transition-colors">{l.label}</a>
                    ) : (
                      <Link to={l.to} className="text-sm text-[var(--au-text-2)] hover:text-[var(--au-primary)] transition-colors">{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
          {/* newsletter */}
          <NewsletterForm />
        </div>
        <div className="mt-14 pt-6 border-t border-[var(--au-border)] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-[var(--au-muted)]">
            © {new Date().getFullYear()} TechNova Inc. All rights reserved.
          </p>
          <p className="text-xs text-[var(--au-muted)]">
            Crafted with care · Powered by curiosity
          </p>
        </div>
      </div>
    </footer>
  );
}

// ---- Page ----

export default function AboutUsPage() {
  const [dark, setDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const tokens = dark ? DARK_TOKENS : LIGHT_TOKENS;

  // SEO: give the document a real title while this page is mounted.
  useEffect(() => {
    const prev = document.title;
    document.title = 'About Us — TechNova | Building the Future with Technology';
    return () => { document.title = prev; };
  }, []);

  return (
    <div
      style={tokens as React.CSSProperties}
      className="min-h-screen bg-[var(--au-bg)] text-[var(--au-text)] transition-colors duration-300"
    >
      <Navbar dark={dark} onToggleDark={() => setDark((v) => !v)} />
      <main>
        <Hero />
        <OurStory />
        <MissionVision />
        <CoreValues />
        <Timeline />
        <Stats />
        <Team />
        <Culture />
        <WhyChooseUs />
        <AwardsSection />
        <Testimonials />
        <Faq />
        <CallToAction />
      </main>
      <Footer />
    </div>
  );
}
