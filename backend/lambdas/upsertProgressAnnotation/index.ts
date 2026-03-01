import { randomUUID } from 'crypto';

import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { getItem, putItem } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { recomputeAndPersistProgressViews, resolveProgressAccess } from '../../shared/progressStore';
import { PROGRESS_ANNOTATION_SK_PREFIX, parseUpsertProgressAnnotationPayload } from '../../shared/progressViews';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { ProgressCoachAnnotation } from '../../shared/types';

const getAnnotationId = (event: Parameters<APIGatewayProxyHandler>[0]): string =>
  event.pathParameters?.annotationId?.trim() || randomUUID();

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete', 'coach', 'admin']);

    const { athleteId } = await resolveProgressAccess(event, auth, ['athlete', 'coach', 'admin']);
    const payload = parseUpsertProgressAnnotationPayload(event.body);
    const annotationId = getAnnotationId(event);
    const nowIso = new Date().toISOString();

    const key = {
      PK: `USER#${athleteId}`,
      SK: `${PROGRESS_ANNOTATION_SK_PREFIX}${annotationId}`
    };
    const existing = await getItem({ Key: key });
    if (existing.Item && existing.Item.entityType !== 'PROGRESS_ANNOTATION') {
      throw new ApiError({
        code: 'CONFLICT',
        message: 'Annotation ID already exists with a different entity type.',
        statusCode: 409
      });
    }

    const existingRecord = existing.Item as ProgressCoachAnnotation | undefined;
    if (existingRecord && existingRecord.athleteId !== athleteId) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'Annotation does not belong to this athlete.',
        statusCode: 403
      });
    }

    const annotation: ProgressCoachAnnotation = {
      annotationId,
      athleteId,
      scope: payload.scope,
      note: payload.note,
      ...(payload.targetKey ? { targetKey: payload.targetKey } : {}),
      ...(payload.correction ? { correction: payload.correction } : {}),
      createdAt: existingRecord?.createdAt ?? nowIso,
      updatedAt: nowIso,
      createdBy: existingRecord?.createdBy ?? auth.userId,
      updatedBy: auth.userId
    };

    await putItem({
      Item: {
        ...key,
        entityType: 'PROGRESS_ANNOTATION',
        ...annotation
      }
    });

    await recomputeAndPersistProgressViews(athleteId);

    return response(existingRecord ? 200 : 201, { annotation });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('upsertProgressAnnotation', baseHandler);
