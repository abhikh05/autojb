'use client';
import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Upload, FileText, Trash2, Save, User } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function ProfilePage() {
  const { data: state, mutate } = useSWR('/api/state', fetcher);
  const { data: settings, mutate: mutateSettings } = useSWR('/api/settings', fetcher);

  const [form, setForm] = useState({ name: '', email: '', phone: '', title: '', keywords: '', location: '', bio: '' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state?.profile) setForm({ ...form, ...state.profile });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.profile]);

  const save = async () => {
    await api('/api/profile', { method: 'POST', body: JSON.stringify(form) });
    setSaved(true); setTimeout(() => setSaved(false), 1600); mutate();
  };

  const uploadResume = async (file: File) => {
    const fd = new FormData(); fd.append('resume', file);
    await fetch('/api/upload-resume', { method: 'POST', body: fd });
    mutateSettings();
  };

  const deleteResume = async () => {
    await api('/api/resume', { method: 'DELETE' }); mutateSettings();
  };

  return (
    <div>
      <PageHeader eyebrow="IDENTITY" title="Profile" subtitle="Your resume + preferences power every application we send." />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
            <Field label="Full name" value={form.name} onChange={v => setForm({ ...form, name: v })} />
            <Field label="Email" value={form.email} onChange={v => setForm({ ...form, email: v })} />
            <Field label="Phone" value={form.phone} onChange={v => setForm({ ...form, phone: v })} />
            <Field label="Location" value={form.location} onChange={v => setForm({ ...form, location: v })} />
            <Field label="Target title" value={form.title} onChange={v => setForm({ ...form, title: v })} />
            <Field label="Keywords (comma-separated)" value={form.keywords} onChange={v => setForm({ ...form, keywords: v })} />
          </div>
          <div>
            <label className="text-[11px] font-mono uppercase tracking-widest text-muted">Short bio</label>
            <textarea
              className="input mt-1.5 h-24 resize-none"
              value={form.bio}
              onChange={e => setForm({ ...form, bio: e.target.value })}
              placeholder="Two sentences on who you are and what you're looking for. Used in outreach emails."
            />
          </div>
          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={save}>
              <Save className="w-3.5 h-3.5" /> {saved ? 'Saved ✓' : 'Save profile'}
            </button>
          </div>
        </div>

        <div className="glass p-6">
          <div className="text-sm font-mono tracking-widest text-muted uppercase mb-4">Resume</div>
          {settings?.hasResume ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg border border-neon/30 bg-neon/5">
                <FileText className="w-5 h-5 text-neon" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink truncate">{settings.resumeName}</div>
                  <div className="text-[11px] text-neon font-mono">READY FOR AUTO-APPLY</div>
                </div>
              </div>
              <button className="btn w-full" onClick={deleteResume}>
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            </div>
          ) : (
            <label className="block border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:border-violet-500/40 hover:bg-white/[0.02] cursor-pointer transition">
              <Upload className="w-6 h-6 text-violet-400 mx-auto mb-2" />
              <div className="text-sm text-ink">Upload PDF resume</div>
              <div className="text-[11px] text-muted mt-1">Required for auto-apply</div>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={e => e.target.files?.[0] && uploadResume(e.target.files[0])}
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[11px] font-mono uppercase tracking-widest text-muted">{label}</label>
      <input className="input mt-1.5" value={value || ''} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
