import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { withRequestLogging } from '../../shared/logger';
import { recomputeAndPersistProgressViews, resolveProgressAccess } from '../../shared/progressStore';
import { parseProgressViewsFilters } from '../../shared/progressViews';
import { errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach', 'admin']);

    const { athleteId } = await resolveProgressAccess(event, auth, ['athlete', 'coach', 'admin']);
    const filters = parseProgressViewsFilters(event.queryStringParameters);
    const report = await recomputeAndPersistProgressViews(athleteId, filters);

    return response(200, { report });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('getProgressViews', baseHandler);
