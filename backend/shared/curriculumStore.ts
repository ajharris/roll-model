import type { APIGatewayProxyEvent } from 'aws-lambda';

import type { AuthContext } from './auth';
import {
  buildProgressRecord,
  buildRecommendationRecord,
  buildRelationshipRecord,
  buildSkillRecord,
  buildStageRecord,
  parseCurriculumSnapshot,
  type CurriculumSnapshot
} from './curriculum';
import { deleteItem, getItem, putItem, queryItems } from './db';
import { parseEntryRecord } from './entries';
import { isCoachLinkActive } from './links';
import { ApiError } from './responses';
import type { UserRole, Checkoff, CheckoffEvidence, Entry } from './types';

const allowedRole = (authRoles: UserRole[], role: UserRole): boolean => authRoles.includes(role);

const athleteIdFromEvent = (event: APIGatewayProxyEvent, auth: AuthContext): string => event.pathParameters?.athleteId ?? auth.userId;

export const resolveCurriculumAccess = async (
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

export const listCurriculumSnapshot = async (athleteId: string): Promise<CurriculumSnapshot> => {
  const result = await queryItems({
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `USER#${athleteId}`,
      ':prefix': 'CURRICULUM_'
    }
  });

  const items = (result.Items ?? []) as Array<Record<string, unknown>>;
  return parseCurriculumSnapshot(items);
};

const curriculumSkPrefixes = [
  'CURRICULUM_STAGE#',
  'CURRICULUM_SKILL#',
  'CURRICULUM_REL#FROM#',
  'CURRICULUM_PROGRESS#',
  'CURRICULUM_RECOMMENDATION#'
];

const isCurriculumRow = (item: Record<string, unknown>): boolean => {
  const sk = item.SK;
  return typeof sk === 'string' && curriculumSkPrefixes.some((prefix) => sk.startsWith(prefix));
};

export const replaceCurriculumSnapshot = async (athleteId: string, snapshot: CurriculumSnapshot): Promise<void> => {
  const currentRows = await queryItems({
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `USER#${athleteId}`
    }
  });

  const existingCurriculumRows = (currentRows.Items ?? []).filter((item) => isCurriculumRow(item as Record<string, unknown>));
  const existingSkSet = new Set(
    existingCurriculumRows
      .map((item) => {
        const sk = (item as { SK?: unknown }).SK;
        return typeof sk === 'string' ? sk : null;
      })
      .filter((sk): sk is string => sk !== null)
  );

  const nextRows = [
    ...snapshot.stages.map((stage) => buildStageRecord(athleteId, stage)),
    ...snapshot.skills.map((skill) => buildSkillRecord(athleteId, skill)),
    ...snapshot.relationships.map((relationship) => buildRelationshipRecord(athleteId, relationship)),
    ...snapshot.progressions.map((progression) => buildProgressRecord(progression)),
    ...snapshot.recommendations.map((recommendation) => buildRecommendationRecord(recommendation))
  ];
  const nextSkSet = new Set(
    nextRows
      .map((item) => (typeof item.SK === 'string' ? item.SK : null))
      .filter((sk): sk is string => sk !== null)
  );

  for (const row of nextRows) {
    await putItem({
      Item: row
    });
  }

  for (const sk of existingSkSet) {
    if (nextSkSet.has(sk)) {
      continue;
    }
    await deleteItem({
      Key: {
        PK: `USER#${athleteId}`,
        SK: sk
      }
    });
  }
};

export const listProgressSignals = async (
  athleteId: string
): Promise<{ checkoffs: Checkoff[]; evidence: CheckoffEvidence[]; entries: Entry[] }> => {
  const [checkoffRows, entriesRows] = await Promise.all([
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
        ':prefix': 'ENTRY#'
      },
      ScanIndexForward: false,
      Limit: 50
    })
  ]);

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

  const entries = (entriesRows.Items ?? [])
    .filter((item) => item.entityType === 'ENTRY')
    .map((item) => parseEntryRecord(item as Record<string, unknown>));

  return { checkoffs, evidence, entries };
};
