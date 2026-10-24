import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'DevScope — Local Developer Operations & AI Telemetry Monitor',
  description:
    'Local developer operations dashboard monitoring workspaces, Antigravity sessions, Git repositories, processes, and AI usage.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
