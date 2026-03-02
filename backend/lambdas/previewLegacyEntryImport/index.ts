import type { APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import { buildLegacyImportPreview } from '../../shared/legacyImport';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';
import type { LegacyImportPreviewRequest } from '../../shared/types';

const parseRequest = (body: string | null): LegacyImportPreviewRequest => {
  if (!body) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body must be valid JSON.',
      statusCode: 400,
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body must be an object.',
      statusCode: 400,
    });
  }

  return parsed as LegacyImportPreviewRequest;
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const payload = parseRequest(event.body);
    const preview = await buildLegacyImportPreview(auth.userId, payload);

    return response(200, { preview });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('previewLegacyEntryImport', baseHandler);
