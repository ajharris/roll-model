import type { APIGatewayProxyEvent } from 'aws-lambda';

import type { AuthContext } from './auth';
import { getItem, putItem, queryItems } from './db';
import { parseEntryRecord } from './entries';
import { isCoachLinkActive } from './links';
import {
  buildProgressViewsReport,
  buildProgressViewsReportRecord,
  parseProgressAnnotationRows,
  parseProgressViewsFilters,
  parseProgressViewsReport,
  PROGRESS_ANNOTATION_SK_PREFIX
} from './progressViews';
import { ApiError } from './responses';
import type { Checkoff, CheckoffEvidence, Entry, ProgressCoachAnnotation, ProgressViewsFilters, ProgressViewsReport, UserRole } from './types';

const allowedRole = (authRoles: UserRole[], role: UserRole): boolean => authRoles.includes(role);

const athleteIdFromEvent = (event: APIGatewayProxyEvent, auth: AuthContext): string => event.pathParameters?.athleteId ?? auth.userId;

export const resolveProgressAccess = async (
  event: APIGatewayProxyEvent,
  auth: AuthContext,
  allowedRoles: UserRole[]
): Promise<{ athleteId: string; actingAsCoach: boolean }> => {
  const roles = auth.roles?.length ? auth.roles : [auth.role];
  if (!allowedRoles.some((role) => allowedRole(roles, role))) {
    throw new ApiError({
      code: 'FORBIDDEN',
      message: 'User does not have permission for this action.',
      statusCode: 403
    });
  }

  const athleteId = athleteIdFromEvent(event, auth);
  const actingAsCoach = athleteId !== auth.userId;

  if (actingAsCoach) {
    if (!allowedRole(roles, 'coach') && !allowedRole(roles, 'admin')) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'athleteId path access requires coach or admin role.',
        statusCode: 403
      });
    }

    const link = await getItem({
      Key: {
        PK: `USER#${athleteId}`,
        SK: `COACH#${auth.userId}`
      }
    });
    if (!isCoachLinkActive(link.Item)) {
      throw new ApiError({
        code: 'FORBIDDEN',
        message: 'Coach is not linked to this athlete.',
        statusCode: 403
      });
    }
  }

  return { athleteId, actingAsCoach };
};

type ProgressSignals = {
  entries: Entry[];
  checkoffs: Checkoff[];
  evidence: CheckoffEvidence[];
  annotations: ProgressCoachAnnotation[];
};

export const listProgressSignals = async (athleteId: string): Promise<ProgressSignals> => {
  const [entriesRows, checkoffRows, annotationRows] = await Promise.all([
    queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${athleteId}`,
        ':prefix': 'ENTRY#'
      },
      ScanIndexForward: false
    }),
    queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${athleteId}`,
        ':prefix': 'CHECKOFF#SKILL#'
      },
      ScanIndexForward: false
    }),
    queryItems({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${athleteId}`,
        ':prefix': PROGRESS_ANNOTATION_SK_PREFIX
      },
      ScanIndexForward: false
    })
  ]);

  const entries = (entriesRows.Items ?? [])
    .filter((item) => item.entityType === 'ENTRY')
    .map((item) => parseEntryRecord(item as Record<string, unknown>));

  const checkoffs: Checkoff[] = [];
  const evidence: CheckoffEvidence[] = [];
  for (const item of checkoffRows.Items ?? []) {
    if (item.entityType === 'CHECKOFF') {
      checkoffs.push(item as unknown as Checkoff);
    }
    if (item.entityType === 'CHECKOFF_EVIDENCE') {
      evidence.push(item as unknown as CheckoffEvidence);
    }
  }

  const annotations = parseProgressAnnotationRows((annotationRows.Items ?? []) as Array<Record<string, unknown>>);

  return { entries, checkoffs, evidence, annotations };
};

export const listPersistedProgressViews = async (athleteId: string): Promise<ProgressViewsReport | null> => {
  const result = await getItem({
    Key: {
      PK: `USER#${athleteId}`,
      SK: 'PROGRESS_VIEWS#LATEST'
    }
  });

  return parseProgressViewsReport(result.Item as Record<string, unknown> | undefined);
};

export const recomputeAndPersistProgressViews = async (
  athleteId: string,
  filters?: ProgressViewsFilters
): Promise<ProgressViewsReport> => {
  const signals = await listProgressSignals(athleteId);
  const normalizedFilters = filters ?? parseProgressViewsFilters(undefined);
  const report = buildProgressViewsReport({
    athleteId,
    entries: signals.entries,
    checkoffs: signals.checkoffs,
    evidence: signals.evidence,
    annotations: signals.annotations,
    filters: normalizedFilters
  });

  await putItem({
    Item: buildProgressViewsReportRecord(report)
  });

  return report;
};
