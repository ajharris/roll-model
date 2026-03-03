import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem } from '../../shared/db';
import { defaultIntegrationSettings, parseIntegrationSettingsRecord } from '../../shared/integrations';
import { withRequestLogging } from '../../shared/logger';
import { errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const existing = await getItem({
      Key: {
        PK: `USER#${auth.userId}`,
        SK: 'INTEGRATION_SETTINGS'
      }
    });

    const nowIso = new Date().toISOString();
    const settings =
      existing.Item && parseIntegrationSettingsRecord(existing.Item as Record<string, unknown>)
        ? parseIntegrationSettingsRecord(existing.Item as Record<string, unknown>)
        : defaultIntegrationSettings(auth.userId, nowIso, auth.userId);

    return response(200, { settings });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('getIntegrationSettings', baseHandler);
