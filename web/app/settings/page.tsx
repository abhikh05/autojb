'use client';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Save, KeyRound, Mail, Chrome, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function SettingsPage() {
  const { data: settings, mutate } = useSWR('/api/settings', fetcher);
  const { data: indeed, mutate: mutateIndeed } = useSWR('/api/indeed/status', fetcher, { refreshInterval: 5000 });
  const [form, setForm] = useState<any>({});
  const [saved, setSaved] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => { if (settings) setForm({ ...settings }); }, [settings]);

  const save = async () => {
    await api('/api/settings', { method: 'POST', body: JSON.stringify(form) });
    setSaved(true); setTimeout(() => setSaved(false), 1600); mutate();
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
      <PageHeader eyebrow="CONFIGURATION" title="Settings" subtitle="Keys, credentials, and schedule for the auto-apply engine." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section icon={KeyRound} title="API Keys" subtitle="For job search and scoring">
          <Field label="SerpAPI key" value={form.serpApiKey} onChange={v => setForm({ ...form, serpApiKey: v })} placeholder="For Google Jobs search" />
          <Field label="OpenAI key" value={form.openaiKey} onChange={v => setForm({ ...form, openaiKey: v })} placeholder="For scoring + email drafts" />
          <Field label="JSearch key" value={form.jsearchKey} onChange={v => setForm({ ...form, jsearchKey: v })} placeholder="Optional alternative" />
        </Section>

        <Section icon={Mail} title="Email outreach" subtitle="Warm intros for jobs without auto-apply">
          <Field label="Gmail address" value={form.gmailUser} onChange={v => setForm({ ...form, gmailUser: v })} />
          <Field label="Gmail app password" value={form.gmailPass} onChange={v => setForm({ ...form, gmailPass: v })} type="password" />
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
          <Field label="Cron expression" value={form.cron} onChange={v => setForm({ ...form, cron: v })} placeholder="0 9 * * 1-5  (weekdays 9am)" />
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={!!form.cronEnabled} onChange={e => setForm({ ...form, cronEnabled: e.target.checked })} />
            <span className="text-sm text-ink">Enable schedule</span>
          </div>
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

function Section({ icon: Icon, title, subtitle, children }: any) {
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

function Field({ label, value, onChange, placeholder, type = 'text' }: any) {
  return (
    <div>
      <label className="text-[11px] font-mono uppercase tracking-widest text-muted">{label}</label>
      <input className="input mt-1.5" type={type} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
