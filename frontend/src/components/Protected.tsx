'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export const Protected = ({
  children,
  allow,
}: {
  children: ReactNode;
  allow: Array<'athlete' | 'coach'>;
}) => {
  const { isAuthenticated, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) router.push('/');
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;
  if (!allow.includes(role as 'athlete' | 'coach')) {
    return <p>This route is restricted by role.</p>;
  }

  return <>{children}</>;
};
