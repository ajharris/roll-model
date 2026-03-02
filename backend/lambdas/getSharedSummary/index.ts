import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getItem, putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import {
  buildShareAuditEvent,
  buildShareEventSk,
  buildShareLinkItemKey,
  buildShareTokenMapKey,
  ensureShareTokenRecord,
  hashShareToken,
  isExpired,
  parseShareLinkRecord,
} from '../../shared/sharing';
import type { ShareEventType } from '../../shared/types';

const getTokenFromPath = (token?: string): string => {
  if (!token || !token.trim()) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'share token is required.',
      statusCode: 400,
    });
  }

  return token.trim();
};

const trackEvent = async (params: {
  athleteId: string;
  shareId: string;
  eventType: ShareEventType;
  createdAt: string;
  payloadVersion: number;
  details?: Record<string, unknown>;
}): Promise<void> => {
  const eventId = uuidv4();
  const auditEvent = buildShareAuditEvent({
    eventId,
    shareId: params.shareId,
    athleteId: params.athleteId,
    eventType: params.eventType,
    createdAt: params.createdAt,
    payloadVersion: params.payloadVersion,
    details: params.details,
  });

  await putItem({
    Item: {
      PK: `USER#${params.athleteId}`,
      SK: buildShareEventSk(params.createdAt, params.shareId, eventId),
      entityType: 'SHARE_AUDIT_EVENT',
      ...auditEvent,
      GSI1PK: `SHARE_EVENT#${auditEvent.eventType}`,
      GSI1SK: `${auditEvent.createdAt}#${auditEvent.athleteId}#${auditEvent.shareId}`,
    },
  });
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const token = getTokenFromPath(event.pathParameters?.token);
    const tokenHash = hashShareToken(token, process.env.SHARE_TOKEN_SALT);

    const mapResult = await getItem({
      Key: buildShareTokenMapKey(tokenHash),
    });

    const mapped = ensureShareTokenRecord(mapResult.Item as Record<string, unknown> | undefined);

    const shareResult = await getItem({
      Key: buildShareLinkItemKey(mapped.athleteId, mapped.shareId),
    });

    if (!shareResult.Item || shareResult.Item.entityType !== 'SHARE_LINK') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Share link not found.',
        statusCode: 404,
      });
    }

    const share = parseShareLinkRecord(shareResult.Item as Record<string, unknown>);
    const nowIso = new Date().toISOString();

    if (share.status === 'revoked') {
      await trackEvent({
        athleteId: share.athleteId,
        shareId: share.shareId,
        eventType: 'access_denied_revoked',
        createdAt: nowIso,
        payloadVersion: share.payloadVersion,
      });
      throw new ApiError({
        code: 'SHARE_REVOKED',
        message: 'This share link has been revoked.',
        statusCode: 410,
      });
    }

    if (isExpired(share.expiresAt, nowIso)) {
      await trackEvent({
        athleteId: share.athleteId,
        shareId: share.shareId,
        eventType: 'access_denied_expired',
        createdAt: nowIso,
        payloadVersion: share.payloadVersion,
      });
      throw new ApiError({
        code: 'SHARE_EXPIRED',
        message: 'This share link has expired.',
        statusCode: 410,
      });
    }

    await trackEvent({
      athleteId: share.athleteId,
      shareId: share.shareId,
      eventType: 'viewed',
      createdAt: nowIso,
      payloadVersion: share.payloadVersion,
      details: {
        sourceIp: event.requestContext.identity?.sourceIp,
      },
    });

    return response(200, {
      readOnly: true,
      expiresAt: share.expiresAt,
      scope: {
        visibility: share.policy.visibility,
        includeFields: share.summary.scope.includeFields,
        excludeFields: share.summary.scope.excludeFields,
        includePartnerData: share.summary.scope.includePartnerData,
        ...(share.summary.scope.dateFrom ? { dateFrom: share.summary.scope.dateFrom } : {}),
        ...(share.summary.scope.dateTo ? { dateTo: share.summary.scope.dateTo } : {}),
        ...(share.summary.scope.skillId ? { skillId: share.summary.scope.skillId } : {}),
        ...(share.summary.scope.coachId ? { coachId: share.summary.scope.coachId } : {}),
      },
      summary: share.summary,
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('getSharedSummary', baseHandler);
