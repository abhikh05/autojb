'use client';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Save, KeyRound, Mail, Chrome, Clock, Check, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

type Settings = {
  masks?: Record<string, string>;
  openaiKeySet?: boolean;
  serpapiKeySet?: boolean;
  jsearchKeySet?: boolean;
  gmailPassSet?: boolean;
  gmailUser?: string;
  cron?: string;
  cronEnabled?: boolean;
};

export default function SettingsPage() {
  const { data: settings, mutate } = useSWR<Settings>('/api/settings', fetcher);
  const { data: indeed, mutate: mutateIndeed } = useSWR('/api/indeed/status', fetcher, { refreshInterval: 5000 });
  const [pending, setPending] = useState<Record<string, string>>({});
  const [gmailUser, setGmailUser] = useState('');
  const [cron, setCron] = useState('');
  const [cronEnabled, setCronEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setGmailUser(settings.gmailUser || '');
      setCron(settings.cron || '');
      setCronEnabled(!!settings.cronEnabled);
    }
  }, [settings]);

  const save = async () => {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ ...pending, gmailUser, cron, cronEnabled })
    });
    setPending({});
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
    mutate();
  };

  const clearSecret = async (field: string) => {
    if (!confirm('Remove this key?')) return;
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ [field]: '' }) });
    mutate();
  };

  const testEmail = async () => {
    setTestMsg('Testing…');
    const r = await api<any>('/api/settings/test-email', { method: 'POST' });
    setTestMsg(r?.ok ? 'Connection OK ✓' : `Failed: ${r?.error || 'unknown'}`);
  };

  const setupIndeed = async () => {
    await api('/api/indeed/setup', { method: 'POST' });
    setTimeout(mutateIndeed, 1200);
  };

  return (
    <div>
      <PageHeader eyebrow="CONFIGURATION" title="Settings" subtitle="API keys stored encrypted on the server — never shown after save." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section icon={KeyRound} title="API keys" subtitle="For job search + AI tailoring">
          <SecretField
            label="OpenAI key"
            placeholder="sk-…"
            fieldName="openaiKey"
            currentMask={settings?.masks?.openaiKey}
            isSet={!!settings?.openaiKeySet}
            pendingValue={pending.openaiKey}
            onChange={v => setPending(p => ({ ...p, openaiKey: v }))}
            onClear={() => clearSecret('openaiKey')}
          />
          <SecretField
            label="SerpAPI key"
            placeholder="Optional — Google Jobs enrichment"
            fieldName="serpapiKey"
            currentMask={settings?.masks?.serpapiKey}
            isSet={!!settings?.serpapiKeySet}
            pendingValue={pending.serpapiKey}
            onChange={v => setPending(p => ({ ...p, serpapiKey: v }))}
            onClear={() => clearSecret('serpapiKey')}
          />
        </Section>

        <Section icon={Mail} title="Email outreach" subtitle="Warm intros for jobs without auto-apply">
          <div>
            <label className="text-[11px] font-mono uppercase tracking-widest text-muted">Gmail address</label>
            <input className="input mt-1.5" value={gmailUser} onChange={e => setGmailUser(e.target.value)} placeholder="you@gmail.com" />
          </div>
          <SecretField
            label="Gmail app password"
            placeholder="16-char app password"
            fieldName="gmailPass"
            currentMask={settings?.masks?.gmailPass}
            isSet={!!settings?.gmailPassSet}
            pendingValue={pending.gmailPass}
            onChange={v => setPending(p => ({ ...p, gmailPass: v }))}
            onClear={() => clearSecret('gmailPass')}
          />
          <div className="flex items-center gap-2">
            <button className="btn btn-sm" onClick={testEmail}>Test connection</button>
            {testMsg && <span className="text-[12px] text-muted2">{testMsg}</span>}
          </div>
        </Section>

        <Section icon={Chrome} title="Indeed / LinkedIn session" subtitle="Login once, reuse cookies for auto-apply">
          <div className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/[0.02]">
            <div className={`w-2.5 h-2.5 rounded-full ${indeed?.loggedIn ? 'bg-neon shadow-[0_0_8px_#00ffd5]' : 'bg-muted'}`} />
            <div className="text-sm text-ink flex-1">{indeed?.loggedIn ? 'Session active' : 'Not signed in'}</div>
            <button className="btn btn-sm btn-primary" onClick={setupIndeed}>Set up</button>
          </div>
          <p className="text-[12px] text-muted2">A Chrome window will open — complete Google login and cookies will be saved.</p>
        </Section>

        <Section icon={Clock} title="Schedule" subtitle="Recurring auto-run">
          <div>
            <label className="text-[11px] font-mono uppercase tracking-widest text-muted">Cron expression</label>
            <input className="input mt-1.5" value={cron} onChange={e => setCron(e.target.value)} placeholder="0 9 * * 1-5  (weekdays 9am)" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={cronEnabled} onChange={e => setCronEnabled(e.target.checked)} className="accent-violet-500" />
            <span className="text-sm text-ink">Enable schedule</span>
          </label>
        </Section>
      </div>

      <div className="flex justify-end mt-6">
        <button className="btn btn-primary" onClick={save}>
          <Save className="w-3.5 h-3.5" /> {saved ? 'Saved ✓' : 'Save all settings'}
        </button>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, subtitle, children }: {
  icon: any; title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div className="glass p-6 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center text-violet-400">
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <div className="text-ink font-medium">{title}</div>
          <div className="text-[12px] text-muted2">{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

// Secret field: shows masked current value + "Replace" toggle to enter new.
// Once saved server-side, the plaintext is NEVER returned — only the mask.
function SecretField({ label, placeholder, fieldName, currentMask, isSet, pendingValue, onChange, onClear }: {
  label: string; placeholder?: string; fieldName: string;
  currentMask?: string; isSet: boolean;
  pendingValue?: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(!isSet);
  const [reveal, setReveal] = useState(false);

  useEffect(() => { setEditing(!isSet && !pendingValue); }, [isSet, pendingValue]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-mono uppercase tracking-widest text-muted">{label}</label>
        {isSet && (
          <span className="pill pill-neon">
            <Check className="w-3 h-3" /> Configured
          </span>
        )}
      </div>

      {isSet && !editing && !pendingValue ? (
        <div className="flex items-center gap-2">
          <input
            className="input font-mono tracking-wider text-muted2"
            value={currentMask || '••••••••••••'}
            readOnly
          />
          <button className="btn btn-sm" onClick={() => setEditing(true)}>Replace</button>
          <button className="btn btn-sm" onClick={onClear} title="Remove key">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            className="input pr-10"
            type={reveal ? 'text' : 'password'}
            placeholder={placeholder}
            value={pendingValue || ''}
            onChange={e => onChange(e.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted hover:text-ink"
            onClick={() => setReveal(r => !r)}
            title={reveal ? 'Hide' : 'Show'}
          >
            {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}
      {pendingValue && (
        <div className="text-[11px] text-violet-400 mt-1">Unsaved — click Save all settings</div>
      )}
    </div>
  );
}
