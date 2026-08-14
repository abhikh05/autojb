import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SidebarProvider } from '@/components/SidebarState';
import { AuthGate } from '@/components/AuthGate';
import { AppShell } from '@/components/AppShell';

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
          <AuthGate>
            <AppShell>{children}</AppShell>
          </AuthGate>
        </SidebarProvider>
      </body>
    </html>
  );
}
