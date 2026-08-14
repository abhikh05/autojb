export function PageHeader({ eyebrow, title, subtitle, actions }: {
  eyebrow?: string; title: string; subtitle?: string; actions?: React.ReactNode;
}) {
  return (
    <div className="flex sm:items-end justify-between mb-6 sm:mb-8 gap-4 sm:gap-6 flex-col sm:flex-row">
      <div>
        {eyebrow && <div className="text-[11px] font-mono tracking-widest text-muted mb-2">{eyebrow}</div>}
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="text-muted2 mt-2 max-w-xl text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
