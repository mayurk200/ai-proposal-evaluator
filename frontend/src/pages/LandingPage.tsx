import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Leaf, Brain, BarChart3, GitCompare, Upload, Shield,
  Zap, ArrowRight, CheckCircle, Star, Sprout
} from 'lucide-react';
import { Button } from '@/components/ui';

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const },
  }),
};

const features = [
  { icon: Brain, title: 'AI-Powered Analysis', desc: 'Specialized AI agents analyze every dimension of your agriculture proposal' },
  { icon: BarChart3, title: 'Smart Scoring', desc: 'Weighted scoring across innovation, market potential, sustainability, and risk' },
  { icon: GitCompare, title: 'Side-by-Side Comparison', desc: 'Compare multiple proposals with radar charts and detailed analytics' },
  { icon: Shield, title: 'Risk Assessment', desc: 'Comprehensive risk evaluation with mitigation strategies' },
  { icon: Sprout, title: 'Sustainability Analysis', desc: 'Environmental, social, and economic sustainability scoring' },
  { icon: Zap, title: 'Instant Results', desc: 'Get comprehensive evaluation reports in minutes, not weeks' },
];

const workflow = [
  { step: '01', title: 'Upload', desc: 'Drag & drop your proposal document' },
  { step: '02', title: 'AI Analysis', desc: 'Specialized agents evaluate your proposal' },
  { step: '03', title: 'Scoring', desc: 'Get weighted scores across all dimensions' },
  { step: '04', title: 'Report', desc: 'Detailed report with actionable insights' },
];

const testimonials = [
  { name: 'Sarah Chen', role: 'VC Partner, GreenField Capital', text: 'AgriEval cut our proposal evaluation time by 80%. The AI insights are remarkably accurate.', rating: 5 },
  { name: 'James Rodriguez', role: 'AgriTech Founder', text: 'The scoring system helped us identify and fix weaknesses before pitching to investors.', rating: 5 },
  { name: 'Priya Sharma', role: 'Director, AgriInnovate Fund', text: 'The comparison feature alone has transformed how we evaluate competing proposals.', rating: 5 },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/70 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center">
              <Leaf className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gradient">AgriEval</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-text-secondary">
            <a href="#features" className="hover:text-primary transition-colors">Features</a>
            <a href="#workflow" className="hover:text-primary transition-colors">How It Works</a>
            <a href="#testimonials" className="hover:text-primary transition-colors">Testimonials</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button variant="ghost" size="sm">Sign In</Button>
            </Link>
            <Link to="/upload">
              <Button variant="primary" size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 gradient-hero opacity-60" />
        <div className="absolute top-20 right-10 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-10 left-10 w-72 h-72 bg-secondary/10 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent/50 text-primary text-sm font-medium mb-6"
            >
              <Sprout className="w-4 h-4" />
              AI-Powered Agriculture Intelligence
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-tight"
            >
              Evaluate Agriculture
              <br />
              <span className="text-gradient">Startups with AI</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="mt-6 text-lg md:text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed"
            >
              Specialized AI agents analyze your startup proposals across innovation,
              market potential, sustainability, and risk — delivering investor-grade evaluations in minutes.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3 }}
              className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Link to="/upload">
                <Button size="lg" className="text-base">
                  Start Free Evaluation
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="secondary" size="lg" className="text-base">
                  View Demo
                </Button>
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.5 }}
              className="mt-12 flex items-center justify-center gap-8 text-sm text-text-muted"
            >
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" />
                <span>Free to start</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" />
                <span>AI agents</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" />
                <span>Results in minutes</span>
              </div>
            </motion.div>
          </div>


        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 bg-white/50">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <motion.p variants={fadeUp} custom={0} className="text-sm font-medium text-primary uppercase tracking-wider">Features</motion.p>
            <motion.h2 variants={fadeUp} custom={1} className="text-4xl font-bold mt-3">Everything you need to evaluate proposals</motion.h2>
            <motion.p variants={fadeUp} custom={2} className="text-text-secondary mt-4 max-w-2xl mx-auto">
              Our AI-powered platform provides comprehensive analysis across every critical dimension of agriculture startup proposals.
            </motion.p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
              >
                <div className="glass-card p-7 h-full">
                  <div className="w-12 h-12 rounded-xl bg-accent/50 flex items-center justify-center mb-4">
                    <f.icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-text">{f.title}</h3>
                  <p className="text-sm text-text-secondary mt-2 leading-relaxed">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-16">
            <motion.p variants={fadeUp} custom={0} className="text-sm font-medium text-primary uppercase tracking-wider">How It Works</motion.p>
            <motion.h2 variants={fadeUp} custom={1} className="text-4xl font-bold mt-3">Four steps to evaluation</motion.h2>
          </motion.div>

          <div className="grid md:grid-cols-4 gap-8">
            {workflow.map((w, i) => (
              <motion.div
                key={w.step}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                className="text-center"
              >
                <div className="w-16 h-16 mx-auto rounded-2xl gradient-primary flex items-center justify-center text-white text-xl font-bold shadow-lg">
                  {w.step}
                </div>
                <h3 className="text-lg font-semibold mt-4">{w.title}</h3>
                <p className="text-sm text-text-secondary mt-2">{w.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-24 bg-white/50">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} className="text-center mb-16">
            <motion.p variants={fadeUp} custom={0} className="text-sm font-medium text-primary uppercase tracking-wider">Testimonials</motion.p>
            <motion.h2 variants={fadeUp} custom={1} className="text-4xl font-bold mt-3">Trusted by industry leaders</motion.h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <motion.div key={t.name} custom={i} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp}>
                <div className="glass-card p-7 h-full">
                  <div className="flex gap-1 mb-4">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                    ))}
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed italic">"{t.text}"</p>
                  <div className="mt-5 pt-4 border-t border-border/50">
                    <p className="text-sm font-semibold text-text">{t.name}</p>
                    <p className="text-xs text-text-muted">{t.role}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass-card-static gradient-primary p-12 md:p-16 text-center text-white rounded-3xl"
          >
            <h2 className="text-3xl md:text-4xl font-bold">Ready to evaluate your next big idea?</h2>
            <p className="mt-4 text-white/80 text-lg max-w-xl mx-auto">
              Join hundreds of investors and founders using AI-powered agriculture proposal evaluation.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/register">
                <button className="px-8 py-3.5 bg-white text-primary font-semibold rounded-xl hover:shadow-lg transition-all">
                  Get Started Free
                </button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border/50">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
              <Leaf className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-gradient">AgriEval</span>
          </div>
          <p className="text-sm text-text-muted">© 2026 AgriEval. AI-powered agriculture evaluation platform.</p>
        </div>
      </footer>
    </div>
  );
}
