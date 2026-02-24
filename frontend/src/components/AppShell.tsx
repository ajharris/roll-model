'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { buildHostedUiLogoutUrl, getHostedUiRuntimeConfig } from '@/lib/cognitoHostedUi';
import { getDefaultRouteForRole } from '@/lib/roleRouting';
import type { UserRole } from '@/types/api';

const navLinksByRole: Record<'athlete' | 'coach' | 'admin', string[]> = {
  athlete: ['/entries', '/entries/new', '/analytics', '/chat', '/export', '/coach-link'],
  coach: ['/coach'],
  admin: ['/admin/config-health'],
};

const roleOptions: Array<Exclude<UserRole, 'unknown'>> = ['athlete', 'coach', 'admin'];

export const AppShell = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, role, roles, setActiveRole, signOut, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const availableRoles = roleOptions.filter((candidate) => roles.includes(candidate));
  const links = role === 'coach' ? navLinksByRole.coach : role === 'admin' ? navLinksByRole.admin : navLinksByRole.athlete;

  return (
    <div className="layout">
      <header>
        <h1>BJJ Lab Notebook</h1>
        <p>Evidence over vibes. Keep observations tight and testable.</p>
        {isAuthenticated && (
          <div className="user-row">
            <span>{user?.email ?? user?.sub}</span>
            <div className="row">
              {availableRoles.length > 1 && (
                <>
                  <label htmlFor="active-role-select">Act as</label>
                  <select
                    id="active-role-select"
                    value={role}
                    onChange={(event) => {
                      const nextRole = event.target.value as Exclude<UserRole, 'unknown'>;
                      setActiveRole(nextRole);
                      const nextLinks = navLinksByRole[nextRole];
                      if (!nextLinks.includes(pathname)) {
                        router.push(getDefaultRouteForRole(nextRole));
                      }
                    }}
                  >
                    {availableRoles.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </>
              )}
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
