import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import {
  buildShareAuditEvent,
  buildShareEventSk,
  buildShareLinkItemKey,
  buildShareTokenMapKey,
  parseShareLinkRecord,
} from '../../shared/sharing';
import type { ShareLink } from '../../shared/types';

const resolveShareId = (shareId?: string): string => {
  if (!shareId || !shareId.trim()) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'shareId is required.',
      statusCode: 400,
    });
  }
  return shareId.trim();
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const shareId = resolveShareId(event.pathParameters?.shareId);
    const existingResult = await getItem({
      Key: buildShareLinkItemKey(auth.userId, shareId),
    });

    if (!existingResult.Item || existingResult.Item.entityType !== 'SHARE_LINK') {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Share link not found.',
        statusCode: 404,
      });
    }

    const existing = parseShareLinkRecord(existingResult.Item as Record<string, unknown>);
    const nowIso = new Date().toISOString();

    if (existing.status === 'revoked') {
      return response(200, {
        revoked: true,
        shareId,
        status: 'revoked',
        revokedAt: existing.revokedAt ?? existing.updatedAt,
      });
    }

    const revoked: ShareLink = {
      ...existing,
      status: 'revoked',
      revokedAt: nowIso,
      updatedAt: nowIso,
    };

    const eventId = uuidv4();
    const auditEvent = buildShareAuditEvent({
      eventId,
      shareId: revoked.shareId,
      athleteId: revoked.athleteId,
      eventType: 'revoked',
      createdAt: nowIso,
      payloadVersion: revoked.payloadVersion,
      details: {
        revokedAt: nowIso,
      },
    });

    await Promise.all([
      putItem({
        Item: {
          ...buildShareLinkItemKey(auth.userId, shareId),
          entityType: 'SHARE_LINK',
          ...revoked,
        },
      }),
      putItem({
        Item: {
          ...buildShareTokenMapKey(revoked.tokenHash),
          entityType: 'SHARE_TOKEN_MAP',
          tokenHash: revoked.tokenHash,
          shareId: revoked.shareId,
          athleteId: revoked.athleteId,
          status: revoked.status,
          createdAt: revoked.createdAt,
          updatedAt: revoked.updatedAt,
          revokedAt: revoked.revokedAt,
          expiresAt: revoked.expiresAt,
          payloadVersion: revoked.payloadVersion,
        },
      }),
      putItem({
        Item: {
          PK: `USER#${auth.userId}`,
          SK: buildShareEventSk(nowIso, shareId, eventId),
          entityType: 'SHARE_AUDIT_EVENT',
          ...auditEvent,
          GSI1PK: `SHARE_EVENT#${auditEvent.eventType}`,
          GSI1SK: `${auditEvent.createdAt}#${auditEvent.athleteId}#${auditEvent.shareId}`,
        },
      }),
    ]);

    return response(200, {
      revoked: true,
      shareId,
      status: revoked.status,
      revokedAt: revoked.revokedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('revokeShareLink', baseHandler);
