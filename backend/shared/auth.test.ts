import type { APIGatewayProxyEvent } from 'aws-lambda';

import { getAuthContext, hasRole, requireRole } from './auth';

const buildEvent = (claims: Record<string, string | undefined>): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: {
        claims,
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('shared auth multi-role parsing', () => {
  it('parses multiple roles from cognito groups and exposes membership checks', () => {
    const auth = getAuthContext(
      buildEvent({
        sub: 'user-1',
        'cognito:groups': 'athlete,admin,coach',
      }),
    );

    expect(auth.roles).toEqual(expect.arrayContaining(['athlete', 'coach', 'admin']));
    expect(auth.role).toBe('admin');
    expect(hasRole(auth, 'athlete')).toBe(true);
    expect(hasRole(auth, 'coach')).toBe(true);
    expect(hasRole(auth, 'admin')).toBe(true);
    expect(() => requireRole(auth, ['coach'])).not.toThrow();
  });

  it('accepts cognito groups encoded as a JSON array string', () => {
    const auth = getAuthContext(
      buildEvent({
        sub: 'user-2',
        'cognito:groups': '["athlete","coach"]',
      }),
    );

    expect(auth.roles).toEqual(expect.arrayContaining(['athlete', 'coach']));
    expect(() => requireRole(auth, ['athlete'])).not.toThrow();
    expect(() => requireRole(auth, ['admin'])).toThrow();
  });
});
