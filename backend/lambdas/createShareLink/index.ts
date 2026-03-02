import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, putItem, queryItems } from '../../shared/db';
import { parseEntryRecord } from '../../shared/entries';
import { isCoachLinkActive } from '../../shared/links';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import {
  SHARE_PAYLOAD_VERSION,
  buildShareAuditEvent,
  buildShareEventSk,
  buildShareLinkItemKey,
  buildShareTokenMapKey,
  buildSharedSessionSummary,
  issueShareToken,
  parseCreateShareLinkRequest,
  resolveShareBaseUrl,
} from '../../shared/sharing';
import type { Entry, ShareLink } from '../../shared/types';

const isTrue = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const nowIso = new Date().toISOString();
    const request = parseCreateShareLinkRequest(event.body, nowIso, {
      enforceCoachReview: isTrue(process.env.SHARE_REQUIRE_COACH_REVIEW),
    });

    if (request.policy.coachId) {
      const link = await getItem({
        Key: {
          PK: `USER#${auth.userId}`,
          SK: `COACH#${request.policy.coachId}`,
        },
      });
      if (!isCoachLinkActive(link.Item as Record<string, unknown> | undefined)) {
        throw new ApiError({
          code: 'FORBIDDEN',
          message: 'Coach is not linked to this athlete.',
          statusCode: 403,
        });
      }
    }

    const entriesResult = await queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :entryPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${auth.userId}`,
        ':entryPrefix': 'ENTRY#',
      },
      ScanIndexForward: false,
    });

    const entries: Entry[] = (entriesResult.Items ?? [])
      .filter((item) => item.entityType === 'ENTRY')
      .map((item) => parseEntryRecord(item as Record<string, unknown>));

    const shareId = uuidv4();
    const summary = buildSharedSessionSummary({
      shareId,
      athleteId: auth.userId,
      generatedAt: nowIso,
      policy: request.policy,
      entries,
    });

    const { token, tokenHash } = issueShareToken(process.env.SHARE_TOKEN_SALT);

    const shareLink: ShareLink = {
      shareId,
      athleteId: auth.userId,
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt: request.expiresAt,
      payloadVersion: SHARE_PAYLOAD_VERSION,
      policy: request.policy,
      coachReview: request.coachReview,
      tokenHash,
      summary,
    };

    const eventId = uuidv4();
    const auditEvent = buildShareAuditEvent({
      eventId,
      shareId,
      athleteId: auth.userId,
      eventType: 'created',
      createdAt: nowIso,
      payloadVersion: shareLink.payloadVersion,
      details: {
        includeFields: shareLink.policy.includeFields,
        excludeFields: shareLink.policy.excludeFields,
        includePartnerData: shareLink.policy.includePartnerData,
        expiresAt: shareLink.expiresAt,
      },
    });

    await Promise.all([
      putItem({
        Item: {
          ...buildShareLinkItemKey(auth.userId, shareId),
          entityType: 'SHARE_LINK',
          ...shareLink,
        },
      }),
      putItem({
        Item: {
          ...buildShareTokenMapKey(tokenHash),
          entityType: 'SHARE_TOKEN_MAP',
          tokenHash,
          shareId,
          athleteId: auth.userId,
          status: shareLink.status,
          createdAt: nowIso,
          updatedAt: nowIso,
          expiresAt: shareLink.expiresAt,
          payloadVersion: shareLink.payloadVersion,
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

    const baseUrl = resolveShareBaseUrl().replace(/\/+$/, '');
    return response(201, {
      share: {
        shareId: shareLink.shareId,
        athleteId: shareLink.athleteId,
        status: shareLink.status,
        createdAt: shareLink.createdAt,
        updatedAt: shareLink.updatedAt,
        expiresAt: shareLink.expiresAt,
        payloadVersion: shareLink.payloadVersion,
        policy: shareLink.policy,
        coachReview: shareLink.coachReview,
      },
      token,
      shareUrl: `${baseUrl}/shared/${token}`,
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('createShareLink', baseHandler);
