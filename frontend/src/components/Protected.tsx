'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode} from 'react';
import { useEffect } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/types/api';

type AllowedRole = Exclude<UserRole, 'unknown'>;

export const Protected = ({
  children,
  allow,
}: {
  children: ReactNode;
  allow: AllowedRole[];
}) => {
  const { isAuthenticated, role, roles, setActiveRole } = useAuth();
  const router = useRouter();
  const effectiveRoles = roles.length ? roles : [role];
  const matchedRole = allow.find((allowedRole) => effectiveRoles.includes(allowedRole));

  useEffect(() => {
    if (!isAuthenticated) router.push('/');
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (!matchedRole) return;
    if (role !== matchedRole) {
      setActiveRole(matchedRole);
    }
  }, [matchedRole, role, setActiveRole]);

  if (!isAuthenticated) return null;
  if (!matchedRole) {
    return <p>This route is restricted by role.</p>;
  }

  return <>{children}</>;
};
