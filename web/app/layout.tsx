import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { SidebarProvider } from '@/components/SidebarState';

export const metadata: Metadata = {
  title: 'Autopilot — Job Search & Auto-Apply',
  description: 'Find jobs and auto-apply across supported platforms.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#050510'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="aurora-noise">
        <div className="aurora-bg" />
        <div className="aurora-grid" />
        <SidebarProvider>
          <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
            <Sidebar />
            <div className="flex flex-col min-w-0 min-h-screen">
              <Topbar />
              <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
            </div>
          </div>
        </SidebarProvider>
      </body>
    </html>
  );
}
