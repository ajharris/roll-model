'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { buildHostedUiLogoutUrl, getHostedUiRuntimeConfig } from '@/lib/cognitoHostedUi';

export const AppShell = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, role, signOut, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const athleteNav = ['/entries', '/entries/new', '/analytics', '/chat', '/export', '/coach-link'];
  const coachNav = ['/coach'];
  const links = role === 'coach' ? coachNav : athleteNav;

  return (
    <div className="layout">
      <header>
        <h1>BJJ Lab Notebook</h1>
        <p>Evidence over vibes. Keep observations tight and testable.</p>
        {isAuthenticated && (
          <div className="user-row">
            <span>{user?.email ?? user?.sub}</span>
            <div className="row">
              <Link href="/feedback" className="button-link">
                Feedback
              </Link>
              <button
                onClick={() => {
                  signOut();
                  if (typeof window !== 'undefined') {
                    const logoutUrl = buildHostedUiLogoutUrl(
                      getHostedUiRuntimeConfig(window.location.origin),
                    );
                    if (logoutUrl) {
                      try {
                        window.location.assign(logoutUrl);
                        return;
                      } catch {
                        // Fall back to local route navigation in non-browser/test environments.
                      }
                    }
                  }
                  router.push('/');
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>
      {isAuthenticated && (
        <nav>
          {links.map((href) => (
            <Link key={href} href={href} className={pathname === href ? 'active' : ''}>
              {href.replace('/', '') || 'home'}
            </Link>
          ))}
        </nav>
      )}
      <main>{children}</main>
    </div>
  );
};
