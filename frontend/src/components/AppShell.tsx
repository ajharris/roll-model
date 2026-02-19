'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';

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
        <h1>BJJ for Betas</h1>
        <p>Evidence over vibes. Keep observations tight and testable.</p>
        {isAuthenticated && (
          <div className="user-row">
            <span>{user?.email ?? user?.sub}</span>
            <button
              onClick={() => {
                signOut();
                router.push('/');
              }}
            >
              Sign out
            </button>
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
