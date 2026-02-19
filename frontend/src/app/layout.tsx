import './globals.css';
import { ReactNode } from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { AppShell } from '@/components/AppShell';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
