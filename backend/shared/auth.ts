import type { APIGatewayProxyEvent } from 'aws-lambda';

import { ApiError } from './responses';
import type { UserRole } from './types';

export interface AuthContext {
  userId: string;
  role: UserRole;
  roles: UserRole[];
}

const parseRole = (rawRole: string): UserRole => {
  if (rawRole === 'athlete' || rawRole === 'coach' || rawRole === 'admin') {
    return rawRole;
  }

  throw new ApiError({
    code: 'INVALID_ROLE',
    message: 'User role is invalid.',
    statusCode: 403
  });
};

const parseCognitoGroups = (rawGroups: string | undefined): string[] => {
  if (!rawGroups) return [];

  const trimmed = rawGroups.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((group): group is string => typeof group === 'string')
          .map((group) => group.trim().toLowerCase())
          .filter(Boolean);
      }
    } catch {
      // Fall back to comma-separated parsing.
    }
  }

  return trimmed
    .split(',')
    .map((group) => group.trim().toLowerCase())
    .filter(Boolean);
};

const dedupeRoles = (roles: UserRole[]): UserRole[] => [...new Set(roles)];

const getRolesFromClaims = (claims: Record<string, string | undefined>): UserRole[] => {
  const roles: UserRole[] = [];
  const roleClaim = claims['custom:role'];
  if (roleClaim) {
    roles.push(parseRole(roleClaim));
  }

  const groups = parseCognitoGroups(claims['cognito:groups']);
  if (groups.includes('admin')) roles.push('admin');
  if (groups.includes('coach')) roles.push('coach');
  if (groups.includes('athlete')) roles.push('athlete');

  const uniqueRoles = dedupeRoles(roles);
  if (uniqueRoles.length) {
    return uniqueRoles;
  }

  throw new ApiError({
    code: 'UNAUTHORIZED',
    message: 'Missing authentication claims.',
    statusCode: 401
  });
};

const getPrimaryRole = (roles: UserRole[]): UserRole => {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('coach')) return 'coach';
  return 'athlete';
};

export const getAuthContext = (event: APIGatewayProxyEvent): AuthContext => {
  const claims = event.requestContext.authorizer?.claims as Record<string, string | undefined> | undefined;
  const userId = claims?.sub;

  if (!userId || !claims) {
    throw new ApiError({
      code: 'UNAUTHORIZED',
      message: 'Missing authentication claims.',
      statusCode: 401
    });
  }

  const roles = getRolesFromClaims(claims);

  return {
    userId,
    roles,
    role: getPrimaryRole(roles)
  };
};

export const requireRole = (auth: AuthContext, allowedRoles: UserRole[]): void => {
  const effectiveRoles = auth.roles?.length ? auth.roles : [auth.role];
  if (!allowedRoles.some((role) => effectiveRoles.includes(role))) {
    throw new ApiError({
      code: 'FORBIDDEN',
      message: 'User does not have permission for this action.',
      statusCode: 403
    });
  }
};

export const hasRole = (auth: AuthContext, role: UserRole): boolean =>
  (auth.roles?.length ? auth.roles : [auth.role]).includes(role);
