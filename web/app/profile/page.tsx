'use client';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Upload, FileText, Trash2, Save, User, CheckCircle2, AlertTriangle, Linkedin, Globe, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Profile = {
  name?: string; email?: string; phone?: string; title?: string; location?: string;
  keywords?: string; bio?: string; linkedin?: string; portfolio?: string; github?: string;
  hasResume?: boolean;
  resume?: { name: string; sizeKB: number; uploadedAt: string } | null;
  ready?: boolean;
};

export default function ProfilePage() {
  const { data: profile, mutate } = useSWR<Profile>('/api/profile', fetcher, { refreshInterval: 0 });
  const [form, setForm] = useState<Profile>({});
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [uploading, setUploading] = useState(false);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const first = useRef(true);

  // Hydrate form once profile arrives.
  useEffect(() => {
    if (profile && first.current) {
      const { hasResume, resume, ready, ...rest } = profile;
      setForm(rest);
      first.current = false;
    }
  }, [profile]);

  // Debounced auto-save on any change.
  const setField = (key: keyof Profile, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
    setSaving('idle');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save({ ...form, [key]: value }), 900);
  };

  const save = async (payload: Profile) => {
    setSaving('saving');
    try {
      await api('/api/profile', { method: 'POST', body: JSON.stringify(payload) });
      setSaving('saved');
      mutate();
      setTimeout(() => setSaving('idle'), 1600);
    } catch {
      setSaving('error');
    }
  };

  const uploadResume = async (file: File) => {
    if (!file.type.includes('pdf')) return alert('PDF only for now');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('resume', file);
      const r = await fetch('/api/upload-resume', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(String(r.status));
      mutate();
    } catch (e: any) {
      alert('Upload failed: ' + (e?.message || e));
    } finally {
      setUploading(false);
    }
  };

  const deleteResume = async () => {
    if (!confirm('Remove your resume? You can re-upload any time.')) return;
    await api('/api/resume', { method: 'DELETE' });
    mutate();
  };

  const readiness = computeReadiness(form, profile);

  return (
    <div>
      <PageHeader
        eyebrow="IDENTITY"
        title="Profile"
        subtitle="Everything the auto-apply engine and AI tailoring pull from. Changes save automatically."
        actions={
          <span className={`pill ${saving === 'saved' ? 'pill-neon' : saving === 'saving' ? 'pill-violet' : saving === 'error' ? 'pill-amber' : 'pill-muted'}`}>
            {saving === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" /> :
             saving === 'saved' ? <CheckCircle2 className="w-3 h-3" /> :
             saving === 'error' ? <AlertTriangle className="w-3 h-3" /> : null}
            {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Save failed' : 'Auto-save on'}
          </span>
        }
      />

      {/* Readiness meter */}
      <div className="glass p-4 mb-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${readiness.ok ? 'border-neon/40 bg-neon/10 text-neon' : 'border-amber/40 bg-amber/10 text-amber'}`}>
            {readiness.ok ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <div className="text-ink font-medium">
              {readiness.ok ? 'Ready to auto-apply' : `${readiness.missing.length} thing${readiness.missing.length === 1 ? '' : 's'} left`}
            </div>
            <div className="text-[12px] text-muted2">
              {readiness.ok ? 'Profile complete. Auto-apply will fill Greenhouse, Lever, Ashby & Workable forms.'
                : `Add: ${readiness.missing.join(', ')}`}
            </div>
          </div>
        </div>
        <div className="w-full sm:w-auto sm:min-w-[220px]">
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full transition-all ${readiness.ok ? 'bg-gradient-to-r from-neon to-cyan-400' : 'bg-gradient-to-r from-violet-500 to-cyan-400'}`}
              style={{ width: `${readiness.pct}%` }}
            />
          </div>
          <div className="text-[11px] font-mono text-muted mt-1 text-right">{readiness.pct}% complete</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Personal */}
        <div className="lg:col-span-2 glass p-6 space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
              <User className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-mono tracking-widest text-muted uppercase">Personal</div>
              <div className="text-ink text-lg font-medium">Who you are</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full name" required value={form.name} onChange={v => setField('name', v)} placeholder="Ada Lovelace" />
            <Field label="Email" required type="email" value={form.email} onChange={v => setField('email', v)} placeholder="you@domain.com" />
            <Field label="Phone" value={form.phone} onChange={v => setField('phone', v)} placeholder="+1 555 123 4567" />
            <Field label="Location" value={form.location} onChange={v => setField('location', v)} placeholder="Remote, NY, Bengaluru, etc." />
            <Field label="Target title" value={form.title} onChange={v => setField('title', v)} placeholder="Senior Software Engineer" />
            <Field label="Keywords (comma-separated)" value={form.keywords} onChange={v => setField('keywords', v)} placeholder="python, aws, distributed systems" />
          </div>

          <div className="pt-2 border-t border-white/5" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field icon={Linkedin} label="LinkedIn URL" value={form.linkedin} onChange={v => setField('linkedin', v)} placeholder="https://linkedin.com/in/…" />
            <Field icon={Globe} label="Portfolio / GitHub" value={form.portfolio} onChange={v => setField('portfolio', v)} placeholder="https://…" />
          </div>

          <div>
            <label className="text-[11px] font-mono uppercase tracking-widest text-muted">Short bio</label>
            <textarea
              className="input mt-1.5 h-24 resize-none"
              value={form.bio || ''}
              onChange={e => setField('bio', e.target.value)}
              placeholder="2-3 sentences. Used for AI tailoring & outreach. Concrete beats fluffy — mention what you build, what stacks, what impact."
            />
          </div>
        </div>

        {/* Resume */}
        <div className="glass p-6 self-start">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-mono tracking-widest text-muted uppercase">Resume</div>
            {profile?.hasResume && <span className="pill pill-neon">ready</span>}
          </div>

          {profile?.hasResume && profile.resume ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg border border-neon/30 bg-neon/5">
                <FileText className="w-5 h-5 text-neon shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink truncate">{profile.resume.name}</div>
                  <div className="text-[11px] text-muted2 font-mono">
                    {profile.resume.sizeKB} KB · uploaded {new Date(profile.resume.uploadedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <label className="btn w-full cursor-pointer">
                <Upload className="w-3.5 h-3.5" /> Replace
                <input type="file" accept="application/pdf" className="hidden"
                  onChange={e => e.target.files?.[0] && uploadResume(e.target.files[0])} />
              </label>
              <button className="btn w-full text-rose/80 hover:text-rose border-rose/20 hover:border-rose/40" onClick={deleteResume}>
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            </div>
          ) : (
            <label className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${uploading ? 'border-violet-500/60 bg-violet-500/5' : 'border-white/10 hover:border-violet-500/40 hover:bg-white/[0.02]'}`}>
              {uploading ? (
                <Loader2 className="w-6 h-6 text-violet-400 mx-auto mb-2 animate-spin" />
              ) : (
                <Upload className="w-6 h-6 text-violet-400 mx-auto mb-2" />
              )}
              <div className="text-sm text-ink">{uploading ? 'Uploading…' : 'Drop PDF here or click'}</div>
              <div className="text-[11px] text-muted mt-1">Required for auto-apply</div>
              <input type="file" accept="application/pdf" className="hidden"
                onChange={e => e.target.files?.[0] && uploadResume(e.target.files[0])} />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', required, icon: Icon }: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  icon?: any;
}) {
  return (
    <div>
      <label className="text-[11px] font-mono uppercase tracking-widest text-muted flex items-center gap-1.5">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
        {required && <span className="text-rose">*</span>}
      </label>
      <input
        className="input mt-1.5"
        type={type}
        value={value || ''}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function computeReadiness(form: Profile, profile: Profile | undefined) {
  const checks: Array<{ label: string; ok: boolean }> = [
    { label: 'full name', ok: !!form.name?.trim() },
    { label: 'email', ok: !!form.email?.trim() },
    { label: 'resume PDF', ok: !!profile?.hasResume },
    { label: 'target title', ok: !!form.title?.trim() },
    { label: 'phone', ok: !!form.phone?.trim() }
  ];
  const done = checks.filter(c => c.ok).length;
  const pct = Math.round((done / checks.length) * 100);
  const missing = checks.filter(c => !c.ok).map(c => c.label);
  const critical = ['full name', 'email', 'resume PDF'];
  const ok = missing.every(m => !critical.includes(m));
  return { pct, missing, ok };
}
