import './globals.css';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/AppShell';
import { AuthProvider } from '@/contexts/AuthContext';
import { assertFrontendConfig } from '@/lib/config';

assertFrontendConfig();

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
