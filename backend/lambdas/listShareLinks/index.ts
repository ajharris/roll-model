import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { queryItems } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { errorResponse, response } from '../../shared/responses';
import { isExpired, parseShareLinkRecord } from '../../shared/sharing';
import type { ShareLink } from '../../shared/types';

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const result = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${auth.userId}`,
        ':prefix': 'SHARE_LINK#',
      },
      ScanIndexForward: false,
    });

    const nowIso = new Date().toISOString();
    const shares: ShareLink[] = (result.Items ?? [])
      .filter((item) => item.entityType === 'SHARE_LINK')
      .map((item) => parseShareLinkRecord(item as Record<string, unknown>))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return response(200, {
      shares: shares.map((share) => ({
        shareId: share.shareId,
        status: share.status,
        createdAt: share.createdAt,
        updatedAt: share.updatedAt,
        expiresAt: share.expiresAt,
        revokedAt: share.revokedAt,
        payloadVersion: share.payloadVersion,
        visibility: share.policy.visibility,
        includePartnerData: share.policy.includePartnerData,
        requireCoachReview: share.policy.requireCoachReview,
        dateFrom: share.policy.dateFrom,
        dateTo: share.policy.dateTo,
        skillId: share.policy.skillId,
        coachId: share.policy.coachId,
        expired: isExpired(share.expiresAt, nowIso),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('listShareLinks', baseHandler);
