'use client';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * App chrome (sidebar + topbar). Hidden on /login so the login page
 * fills the viewport cleanly.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === '/login') return <>{children}</>;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <Sidebar />
      <div className="flex flex-col min-w-0 min-h-screen">
        <Topbar />
        <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
