import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Leaf, ShieldCheck } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { authApi } from '@/services/auth.service';
import { useAuthStore } from '@/store/authStore';

/**
 * The only unauthenticated page in the system.
 *
 * There is no sign-up: this is an internal evaluation console with seeded operator
 * accounts, and anyone who could register would be able to read every proposal and see
 * every funding decision. New accounts are created by an administrator.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ProtectedRoute remembers where the user was headed before being bounced here.
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await authApi.login(form);
      setAuth(result.user, result.token);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen gradient-hero">
      <div className="hidden items-center justify-center p-12 lg:flex lg:w-1/2">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-md"
        >
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl gradient-primary">
            <Leaf className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-text">AgriEval</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">
            Evidence-based evaluation of agricultural innovation proposals. Every score is
            traceable to the words in the document that produced it.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-text-secondary">
            {[
              'Duplicate ideas are caught before they cost an evaluation',
              'Every score cites the text it came from',
              'Approvals are balanced across categories and companies',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                {line}
              </li>
            ))}
          </ul>
        </motion.div>
      </div>

      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card-static w-full max-w-sm rounded-2xl p-8"
        >
          <h2 className="text-xl font-bold text-text">Sign in</h2>
          <p className="mt-1 text-sm text-text-muted">
            Internal evaluation console.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Input
              id="email"
              type="email"
              label="Email"
              autoComplete="username"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />

            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                label="Password"
                autoComplete="current-password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-9 text-text-muted hover:text-text"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
            )}

            <Button type="submit" loading={loading} className="w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-text-muted">
            Accounts are created by an administrator. There is no public sign-up.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
