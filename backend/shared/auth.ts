import type { APIGatewayProxyEvent } from 'aws-lambda';

import { ApiError } from './responses';
import type { UserRole } from './types';

export interface AuthContext {
  userId: string;
  role: UserRole;
}

const parseRole = (rawRole: string): UserRole => {
  if (rawRole === 'athlete' || rawRole === 'coach') {
    return rawRole;
  }

  throw new ApiError({
    code: 'INVALID_ROLE',
    message: 'User role is invalid.',
    statusCode: 403
  });
};

export const getAuthContext = (event: APIGatewayProxyEvent): AuthContext => {
  const claims = event.requestContext.authorizer?.claims;
  const userId = claims?.sub;
  const roleClaim = claims?.['custom:role'];

  if (!userId || !roleClaim) {
    throw new ApiError({
      code: 'UNAUTHORIZED',
      message: 'Missing authentication claims.',
      statusCode: 401
    });
  }

  return {
    userId,
    role: parseRole(roleClaim)
  };
};

export const requireRole = (auth: AuthContext, allowedRoles: UserRole[]): void => {
  if (!allowedRoles.includes(auth.role)) {
    throw new ApiError({
      code: 'FORBIDDEN',
      message: 'User does not have permission for this action.',
      statusCode: 403
    });
  }
};
