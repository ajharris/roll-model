import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { withRequestLogging } from '../../shared/logger';
import { buildPartnerProfile, parsePartnerUpsertPayload, putPartnerProfile } from '../../shared/partners';
import { errorResponse, response } from '../../shared/responses';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parsePartnerUpsertPayload(event.body);
    const nowIso = new Date().toISOString();
    const partner = buildPartnerProfile(auth.userId, payload, nowIso);

    await putPartnerProfile(partner);
    return response(201, { partner });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('createPartner', baseHandler);
