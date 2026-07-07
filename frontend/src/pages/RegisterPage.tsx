import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Leaf, Eye, EyeOff } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { authApi } from '@/services/auth.service';
import { useAuthStore } from '@/store/authStore';
import { proposalApi } from '@/services/proposal.service';
import { getApiErrorMessage } from '@/utils';
import { Home } from 'lucide-react';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const claimId = searchParams.get('claimId');
  const { setAuth } = useAuthStore();
  const [form, setForm] = useState({ name: '', email: '', password: '', company: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await authApi.register(form);
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
      setError(getApiErrorMessage(err, 'Registration failed. Please try again.'));
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
            Join
            <br />
            <span className="text-gradient">AgriEval</span>
          </h1>
          <p className="mt-4 text-text-secondary text-lg leading-relaxed">
            Start evaluating agriculture startup proposals with our AI-powered platform. Free to get started.
          </p>
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
              <h2 className="text-2xl font-bold text-text">Create account</h2>
              <p className="text-sm text-text-muted mt-1">Get started with free evaluation</p>
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

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                id="name"
                label="Full Name"
                type="text"
                placeholder="John Doe"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <Input
                id="email"
                label="Email"
                type="email"
                placeholder="you@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
              <Input
                id="company"
                label="Company (Optional)"
                type="text"
                placeholder="Your company"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
              <div className="relative">
                <Input
                  id="password"
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Min 8 characters"
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
                Create Account
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-text-muted">
              Already have an account?{' '}
              <Link to={`/login${claimId ? `?claimId=${claimId}` : ''}`} className="text-primary font-medium hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
