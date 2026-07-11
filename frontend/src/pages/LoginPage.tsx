import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Leaf, Eye, EyeOff } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { authApi } from '@/services/auth.service';
import { useAuthStore } from '@/store/authStore';
import { proposalApi } from '@/services/proposal.service';
import { APP_VERSION } from '@/version';
import { getApiErrorMessage } from '@/utils';
import { Home } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const claimId = searchParams.get('claimId');
  const { setAuth } = useAuthStore();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await authApi.login(form);
      setAuth(result.user, result.token);

      if (claimId) {
        try {
          await proposalApi.claim(claimId);
          navigate(`/proposals/${claimId}`);
          return;
        } catch (claimErr) {
          console.error('Failed to claim proposal:', claimErr);
        }
      }
      
      navigate('/dashboard');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Login failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex gradient-hero">
      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-12">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7 }}
          className="max-w-md"
        >
          <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center mb-8">
            <Leaf className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-text leading-tight">
            Welcome back to
            <br />
            <span className="text-gradient">AgriEval</span>
            <span className="ml-2 inline-block align-middle rounded-md bg-accent/60 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary">Beta v{APP_VERSION}</span>
          </h1>
          <p className="mt-4 text-text-secondary text-lg leading-relaxed">
            Continue evaluating agriculture startup proposals with our AI-powered platform.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4">
            {[
              { value: '7', label: 'Evaluation Parameters' },
              { value: '10', label: 'AI Agents' },
              { value: '0–100', label: 'Weighted Score' },
              { value: '4', label: 'Recommendation Levels' },
            ].map((stat) => (
              <div key={stat.label} className="glass-card-static p-4 text-center">
                <p className="text-2xl font-bold text-primary">{stat.value}</p>
                <p className="text-xs text-text-muted mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Right Panel - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md"
        >
          <div className="glass-card-static p-8 rounded-2xl relative">
            <Link to="/" className="absolute top-4 left-4 p-2 text-text-muted hover:text-primary transition-colors flex items-center gap-1 text-sm">
              <Home className="w-4 h-4" /> Home
            </Link>
            <div className="text-center mb-8">
              <div className="lg:hidden w-12 h-12 mx-auto rounded-xl gradient-primary flex items-center justify-center mb-4">
                <Leaf className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-text">
                Sign in
                <span className="ml-2 inline-block align-middle rounded-md bg-accent/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Beta v{APP_VERSION}</span>
              </h2>
              <p className="text-sm text-text-muted mt-1">Enter your credentials to continue</p>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600"
              >
                {error}
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <Input
                id="email"
                label="Email"
                type="email"
                placeholder="you@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
              <div className="relative">
                <Input
                  id="password"
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-9 text-text-muted hover:text-text"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <Button type="submit" loading={loading} className="w-full" size="lg">
                Sign In
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-text-muted">
              Don't have an account?{' '}
              <Link to={`/register${claimId ? `?claimId=${claimId}` : ''}`} className="text-primary font-medium hover:underline">
                Sign up
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
