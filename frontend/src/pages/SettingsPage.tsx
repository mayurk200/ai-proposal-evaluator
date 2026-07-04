import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  User, Sparkles, FileText, ScanLine, HardDrive, Shield, KeyRound,
  Palette, Settings as SettingsIcon, AlertTriangle, CheckCircle2, RotateCcw, Lock,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, Button, Input, Select, Toggle, Badge } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import {
  settingsService,
  type SettingsField,
  type SettingsGroup,
  type SettingsData,
  type SettingsValue,
} from '@/services/settings.service';

const GROUP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles, FileText, ScanLine, HardDrive, Shield, KeyRound, Palette,
};

type Banner = { type: 'success' | 'error'; message: string } | null;

export default function SettingsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  const [groups, setGroups] = useState<SettingsGroup[]>([]);
  const [fields, setFields] = useState<SettingsField[]>([]);
  const [values, setValues] = useState<SettingsData>({});
  const [original, setOriginal] = useState<SettingsData>({});
  const [secretConfigured, setSecretConfigured] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);

  // Profile card (local, mirrors the previous page)
  const [profile, setProfile] = useState({
    name: user?.name || '',
    email: user?.email || '',
    company: (user as any)?.company || '',
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [schema, data] = await Promise.all([
          settingsService.getSchema(),
          settingsService.getSettings(),
        ]);
        if (!active) return;
        setGroups(schema.groups);
        setFields(schema.fields);
        hydrate(schema.fields, data);
      } catch (e: any) {
        if (active) setLoadError(e?.response?.data?.message || 'Failed to load settings.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Populate working + original state from a settings payload. */
  function hydrate(schemaFields: SettingsField[], data: SettingsData) {
    const working: SettingsData = {};
    const configured: Record<string, boolean> = {};
    for (const f of schemaFields) {
      const raw = data[f.group]?.[f.key];
      if (!working[f.group]) working[f.group] = {};
      if (f.secret) {
        // Secrets never round-trip: start empty, remember whether one is set.
        configured[f.id] = typeof raw === 'string' && raw.length > 0;
        working[f.group][f.key] = '';
      } else {
        working[f.group][f.key] = raw as SettingsValue;
      }
    }
    setValues(working);
    setOriginal(JSON.parse(JSON.stringify(working)));
    setSecretConfigured(configured);
  }

  function setField(field: SettingsField, value: SettingsValue) {
    setValues((prev) => ({
      ...prev,
      [field.group]: { ...prev[field.group], [field.key]: value },
    }));
  }

  /** Nested patch of only what changed (secrets included only when typed). */
  const patch = useMemo<SettingsData>(() => {
    const out: SettingsData = {};
    for (const f of fields) {
      const cur = values[f.group]?.[f.key];
      if (f.secret) {
        if (typeof cur === 'string' && cur.trim() !== '') {
          (out[f.group] ??= {})[f.key] = cur;
        }
      } else if (cur !== original[f.group]?.[f.key]) {
        (out[f.group] ??= {})[f.key] = cur;
      }
    }
    return out;
  }, [values, original, fields]);

  const dirty = Object.keys(patch).length > 0;

  async function handleSave() {
    if (!dirty) return;
    setSaving(true);
    setBanner(null);
    try {
      const updated = await settingsService.updateSettings(patch);
      hydrate(fields, updated);
      setBanner({ type: 'success', message: 'Settings saved. Live changes apply immediately; others on next restart.' });
    } catch (e: any) {
      setBanner({ type: 'error', message: e?.response?.data?.message || 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm('Reset all settings to their default (code/environment) values?')) return;
    setSaving(true);
    setBanner(null);
    try {
      const defaults = await settingsService.resetSettings();
      hydrate(fields, defaults);
      setBanner({ type: 'success', message: 'Settings reset to defaults.' });
    } catch (e: any) {
      setBanner({ type: 'error', message: e?.response?.data?.message || 'Failed to reset settings.' });
    } finally {
      setSaving(false);
    }
  }

  const fieldsByGroup = useMemo(() => {
    const map: Record<string, SettingsField[]> = {};
    for (const f of fields) (map[f.group] ??= []).push(f);
    return map;
  }, [fields]);

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6 pb-24">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text">Settings</h1>
            <p className="text-sm text-text-muted mt-1">Configure the evaluation engine, storage, security, and more.</p>
          </div>
          {!isAdmin && (
            <Badge variant="warning" className="flex items-center gap-1 whitespace-nowrap">
              <Lock className="w-3 h-3" /> Read-only
            </Badge>
          )}
        </motion.div>

        {!isAdmin && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-yellow-50 border border-yellow-200 text-xs text-yellow-800">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>You can view configuration, but only administrators can change it. Ask an admin, or set your account role to <code>ADMIN</code>.</span>
          </div>
        )}

        {banner && (
          <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${banner.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            {banner.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {banner.message}
          </div>
        )}

        {/* Profile */}
        <Card hover={false}>
          <div className="flex items-center gap-3 mb-6"><User className="w-5 h-5 text-primary" /><h3 className="text-base font-semibold">Profile</h3></div>
          <div className="space-y-4">
            <Input label="Name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            <Input label="Email" value={profile.email} disabled />
            <Input label="Company" value={profile.company} onChange={(e) => setProfile({ ...profile, company: e.target.value })} />
          </div>
        </Card>

        {loading && (
          <Card hover={false}><p className="text-sm text-text-muted">Loading configuration…</p></Card>
        )}
        {loadError && (
          <Card hover={false}><p className="text-sm text-red-500">{loadError}</p></Card>
        )}

        {!loading && !loadError && groups.map((group) => {
          const Icon = GROUP_ICONS[group.icon] || SettingsIcon;
          const groupFields = fieldsByGroup[group.id] || [];
          if (!groupFields.length) return null;
          return (
            <Card hover={false} key={group.id}>
              <div className="flex items-center gap-3 mb-1">
                <Icon className="w-5 h-5 text-primary" />
                <h3 className="text-base font-semibold">{group.label}</h3>
              </div>
              <p className="text-xs text-text-muted mb-5">{group.description}</p>
              <div className="space-y-5">
                {groupFields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    value={values[field.group]?.[field.key]}
                    secretConfigured={!!secretConfigured[field.id]}
                    disabled={!isAdmin || saving}
                    onChange={(v) => setField(field, v)}
                  />
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Sticky save bar */}
      {isAdmin && !loading && !loadError && (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-white/90 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-xs text-text-muted">
              {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleReset} disabled={saving}>
                <RotateCcw className="w-4 h-4" /> Reset to defaults
              </Button>
              <Button size="sm" onClick={handleSave} loading={saving} disabled={!dirty || saving}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

// ===== Field renderer =====
function FieldRow({
  field, value, secretConfigured, disabled, onChange,
}: {
  field: SettingsField;
  value: SettingsValue | undefined;
  secretConfigured: boolean;
  disabled: boolean;
  onChange: (v: SettingsValue) => void;
}) {
  const hint = (
    <div className="flex items-center gap-2 flex-wrap">
      {field.description && <span className="text-xs text-text-muted">{field.description}</span>}
      {!field.appliesLive && <Badge variant="default" className="text-[10px] py-0">Restart required</Badge>}
      {field.appliesLive && <Badge variant="info" className="text-[10px] py-0">Live</Badge>}
      {field.danger && (
        <Badge variant="danger" className="text-[10px] py-0 flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5" /> Sensitive
        </Badge>
      )}
    </div>
  );

  // Boolean → inline toggle row
  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-4">
        <div>
          <label className="block text-sm font-medium text-text">{field.label}</label>
          {hint}
        </div>
        <Toggle checked={value === true} disabled={disabled} onChange={onChange} />
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div>
        <Select
          label={field.label}
          value={String(value ?? '')}
          disabled={disabled}
          options={field.options || []}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="mt-1.5">{hint}</div>
      </div>
    );
  }

  if (field.type === 'secret') {
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-sm font-medium text-text">{field.label}</label>
          <Badge variant={secretConfigured ? 'success' : 'default'} className="text-[10px] py-0">
            {secretConfigured ? 'Configured' : 'Not set'}
          </Badge>
        </div>
        <Input
          type="password"
          autoComplete="new-password"
          value={String(value ?? '')}
          disabled={disabled}
          placeholder={secretConfigured ? '•••••••• (leave blank to keep)' : 'Enter value'}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="mt-1.5">{hint}</div>
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-text">{field.label}</label>
        <textarea
          value={String(value ?? '')}
          disabled={disabled}
          placeholder={field.placeholder}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl border border-border bg-white/80 backdrop-blur-sm text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 resize-y disabled:opacity-50"
        />
        {hint}
      </div>
    );
  }

  // number / text
  return (
    <div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label={field.label}
            type={field.type === 'number' ? 'number' : 'text'}
            value={value === undefined || value === null ? '' : String(value)}
            disabled={disabled}
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(e) =>
              onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)
            }
          />
        </div>
        {field.unit && <span className="pb-2.5 text-xs text-text-muted whitespace-nowrap">{field.unit}</span>}
      </div>
      <div className="mt-1.5">{hint}</div>
    </div>
  );
}
