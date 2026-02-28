import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';

import { getAuthContext, requireRole } from '../../shared/auth';
import {
  BackupValidationError,
  buildRestoreItemsFromBackup,
  type FullBackupEnvelope,
  parseAndValidateBackup
} from '../../shared/backups';
import { batchWriteItems } from '../../shared/db';
import { withRequestLogging } from '../../shared/logger';
import { ApiError, errorResponse, response } from '../../shared/responses';

const parseBody = (event: APIGatewayProxyEvent): unknown => {
  if (!event.body) {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body is required.',
      statusCode: 400
    });
  }

  try {
    return JSON.parse(event.body) as unknown;
  } catch {
    throw new ApiError({
      code: 'INVALID_REQUEST',
      message: 'Request body must be valid JSON.',
      statusCode: 400
    });
  }
};

const baseHandler: APIGatewayProxyHandler = async (event) => {
  try {
    const auth = getAuthContext(event);
    requireRole(auth, ['athlete']);

    const rawBody = parseBody(event);

    let backup: FullBackupEnvelope;
    try {
      backup = parseAndValidateBackup(rawBody);
    } catch (error) {
      if (error instanceof BackupValidationError) {
        throw new ApiError({
          code: error.reason === 'schema_version' ? 'INCOMPATIBLE_BACKUP_SCHEMA' : 'INVALID_BACKUP_FORMAT',
          message: error.message,
          statusCode: 400
        });
      }
      throw error;
    }

    if (backup.full.athleteId !== auth.userId) {
      throw new ApiError({
        code: 'INVALID_BACKUP_FORMAT',
        message: `Backup athleteId (${backup.full.athleteId}) does not match authenticated user.`,
        statusCode: 400
      });
    }

    const items = buildRestoreItemsFromBackup(backup.full);
    if (items.length > 0) {
      await batchWriteItems(items);
    }

    return response(200, {
      restored: true,
      athleteId: auth.userId,
      counts: {
        entries: backup.full.entries.length,
        partnerProfiles: backup.full.partnerProfiles.length,
        comments: backup.full.comments.length,
        links: backup.full.links.length,
        aiThreads: backup.full.aiThreads.length,
        aiMessages: backup.full.aiMessages.length,
        weeklyPlans: backup.full.weeklyPlans.length,
        curriculumStages: backup.full.curriculumStages.length,
        curriculumSkills: backup.full.curriculumSkills.length,
        curriculumRelationships: backup.full.curriculumRelationships.length,
        curriculumProgressions: backup.full.curriculumProgressions.length,
        curriculumGraph: backup.full.curriculumGraph ? 1 : 0,
        itemsWritten: items.length
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handler: APIGatewayProxyHandler = withRequestLogging('restoreData', baseHandler);
