import { motion } from 'framer-motion';
import { User, Bell, Shield, Palette } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useState } from 'react';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [profile, setProfile] = useState({ name: user?.name || '', email: user?.email || '', company: (user as any)?.company || '' });
  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h1 className="text-2xl font-bold text-text">Settings</h1>
          <p className="text-sm text-text-muted mt-1">Manage your account and preferences</p>
        </motion.div>
        <Card hover={false}>
          <div className="flex items-center gap-3 mb-6"><User className="w-5 h-5 text-primary" /><h3 className="text-base font-semibold">Profile</h3></div>
          <div className="space-y-4">
            <Input label="Name" value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} />
            <Input label="Email" value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })} disabled />
            <Input label="Company" value={profile.company} onChange={e => setProfile({ ...profile, company: e.target.value })} />
            <Button size="sm">Save Changes</Button>
          </div>
        </Card>
        <Card hover={false}>
          <div className="flex items-center gap-3 mb-6"><Bell className="w-5 h-5 text-primary" /><h3 className="text-base font-semibold">Notifications</h3></div>
          <div className="space-y-3">
            {['Evaluation complete', 'Weekly summary', 'New features'].map(n => (
              <label key={n} className="flex items-center justify-between p-3 rounded-xl hover:bg-accent-light/30 cursor-pointer">
                <span className="text-sm text-text-secondary">{n}</span>
                <input type="checkbox" defaultChecked className="w-4 h-4 text-primary rounded accent-primary" />
              </label>
            ))}
          </div>
        </Card>
        <Card hover={false}>
          <div className="flex items-center gap-3 mb-4"><Palette className="w-5 h-5 text-primary" /><h3 className="text-base font-semibold">Appearance</h3></div>
          <p className="text-sm text-text-muted">Light theme active. Dark mode coming soon.</p>
        </Card>
        <Card hover={false}>
          <div className="flex items-center gap-3 mb-4"><Shield className="w-5 h-5 text-primary" /><h3 className="text-base font-semibold">API Configuration</h3></div>
          <p className="text-sm text-text-muted mb-3">Groq API key is configured server-side for security.</p>
          <div className="p-3 rounded-xl bg-accent-light/50 text-xs text-text-secondary">Model: llama-3.3-70b-versatile • 7 AI Agents Active</div>
        </Card>
      </div>
    </AppLayout>
  );
}
