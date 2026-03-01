import type { QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { batchWriteItems, queryItems } from '../../shared/db';
import { handler as exportHandler } from '../exportData/index';

import { handler } from './index';


jest.mock('../../shared/db');

const mockBatchWriteItems = jest.mocked(batchWriteItems);
const mockQueryItems = jest.mocked(queryItems);

const buildAthleteEvent = (body: string | null): APIGatewayProxyEvent =>
  ({
    body,
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete'
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

const buildExportEvent = (): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete'
        }
      }
    }
  }) as unknown as APIGatewayProxyEvent;

describe('restoreData handler', () => {
  beforeEach(() => {
    mockBatchWriteItems.mockReset();
    mockQueryItems.mockReset();
    mockBatchWriteItems.mockResolvedValue();
  });

  it('round-trips export json into restore writes', async () => {
    mockQueryItems
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'USER#athlete-1',
            SK: 'ENTRY#2024-01-01',
            entityType: 'ENTRY',
            entryId: 'entry-1',
            athleteId: 'athlete-1',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            sections: { shared: 'shared notes', private: 'private notes' },
            sessionMetrics: {
              durationMinutes: 60,
              intensity: 7,
              rounds: 6,
              giOrNoGi: 'gi',
              tags: ['guard']
            },
            rawTechniqueMentions: ['knee cut']
          }
        ]
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'ENTRY#entry-1',
            SK: 'COMMENT#2024-01-02T00:00:00.000Z#comment-1',
            entityType: 'COMMENT',
            commentId: 'comment-1',
            entryId: 'entry-1',
            coachId: 'coach-1',
            createdAt: '2024-01-02T00:00:00.000Z',
            body: 'Nice work',
            visibility: 'visible'
          }
        ]
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'USER#athlete-1',
            SK: 'COACH#coach-1',
            entityType: 'COACH_LINK',
            athleteId: 'athlete-1',
            coachId: 'coach-1',
            status: 'active',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
            createdBy: 'athlete-1'
          }
        ]
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'USER#athlete-1',
            SK: 'PARTNER#partner-1',
            entityType: 'PARTNER_PROFILE',
            partnerId: 'partner-1',
            athleteId: 'athlete-1',
            displayName: 'Alex',
            styleTags: ['pressure-passer'],
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z'
          }
        ]
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'USER#athlete-1',
            SK: 'AI_THREAD#thread-1',
            entityType: 'AI_THREAD',
            threadId: 'thread-1',
            title: 'Training Reflection',
            createdAt: '2024-01-03T00:00:00.000Z',
            lastActiveAt: '2024-01-03T00:00:00.000Z'
          }
        ]
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: []
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: []
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: []
      } as unknown as QueryCommandOutput)
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'AI_THREAD#thread-1',
            SK: 'MSG#2024-01-03T00:01:00.000Z#msg-1',
            entityType: 'AI_MESSAGE',
            messageId: 'msg-1',
            threadId: 'thread-1',
            role: 'assistant',
            content: 'Keep going',
            visibilityScope: 'shared',
            createdAt: '2024-01-03T00:01:00.000Z'
          }
        ]
      } as unknown as QueryCommandOutput);

    const exportResult = (await exportHandler(buildExportEvent(), {} as never, () => undefined)) as APIGatewayProxyResult;
    expect(exportResult.statusCode).toBe(200);

    const exportedPayload = JSON.parse(exportResult.body) as {
      full: {
        athleteId: string;
        entries: Array<Record<string, unknown>>;
        comments: Array<Record<string, unknown>>;
        links: Array<Record<string, unknown>>;
        partnerProfiles: Array<Record<string, unknown>>;
        aiThreads: Array<Record<string, unknown>>;
        aiMessages: Array<Record<string, unknown>>;
        weeklyPlans: Array<Record<string, unknown>>;
      };
    };

    const restoreResult = (await handler(
      buildAthleteEvent(exportResult.body),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(restoreResult.statusCode).toBe(200);
    expect(mockBatchWriteItems).toHaveBeenCalledTimes(1);

    const writtenItems = mockBatchWriteItems.mock.calls[0]?.[0] ?? [];
    expect(writtenItems).toEqual(
      expect.arrayContaining([
        {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2024-01-01T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          ...exportedPayload.full.entries[0]
        },
        {
          PK: 'ENTRY#entry-1',
          SK: 'META',
          entityType: 'ENTRY_META',
          athleteId: 'athlete-1',
          createdAt: '2024-01-01T00:00:00.000Z'
        },
        {
          PK: 'ENTRY#entry-1',
          SK: 'COMMENT#2024-01-02T00:00:00.000Z#comment-1',
          entityType: 'COMMENT',
          ...exportedPayload.full.comments[0]
        },
        {
          PK: 'USER#athlete-1',
          SK: 'COACH#coach-1',
          entityType: 'COACH_LINK',
          ...exportedPayload.full.links[0]
        },
        {
          PK: 'USER#athlete-1',
          SK: 'PARTNER#partner-1',
          entityType: 'PARTNER_PROFILE',
          ...exportedPayload.full.partnerProfiles[0]
        },
        {
          PK: 'USER#athlete-1',
          SK: 'AI_THREAD#thread-1',
          entityType: 'AI_THREAD',
          ...exportedPayload.full.aiThreads[0]
        },
        {
          PK: 'AI_THREAD#thread-1',
          SK: 'MSG#2024-01-03T00:01:00.000Z#msg-1',
          entityType: 'AI_MESSAGE',
          ...exportedPayload.full.aiMessages[0]
        }
      ])
    );

    const restoreBody = JSON.parse(restoreResult.body) as {
      restored: boolean;
      counts: {
        entries: number;
        partnerProfiles: number;
        comments: number;
        links: number;
        aiThreads: number;
        aiMessages: number;
        weeklyPlans: number;
        curriculumStages: number;
        curriculumSkills: number;
        curriculumRelationships: number;
        curriculumProgressions: number;
        curriculumGraph: number;
        itemsWritten: number;
      };
    };
    expect(restoreBody.restored).toBe(true);
    expect(restoreBody.counts.entries).toBe(1);
    expect(restoreBody.counts.partnerProfiles).toBe(1);
    expect(restoreBody.counts.comments).toBe(1);
    expect(restoreBody.counts.links).toBe(1);
    expect(restoreBody.counts.aiThreads).toBe(1);
    expect(restoreBody.counts.aiMessages).toBe(1);
    expect(restoreBody.counts.weeklyPlans).toBe(0);
    expect(restoreBody.counts.curriculumStages).toBe(0);
    expect(restoreBody.counts.curriculumSkills).toBe(0);
    expect(restoreBody.counts.curriculumRelationships).toBe(0);
    expect(restoreBody.counts.curriculumProgressions).toBe(0);
    expect(restoreBody.counts.curriculumGraph).toBe(0);
    expect(restoreBody.counts.itemsWritten).toBeGreaterThanOrEqual(7);
  });

  it('rejects incompatible backup schema version with clear error', async () => {
    const invalidBackup = {
      schemaVersion: '2099-01-01',
      generatedAt: '2026-02-26T00:00:00.000Z',
      full: {
        athleteId: 'athlete-1',
        entries: [],
        comments: [],
        links: [],
        aiThreads: [],
        aiMessages: []
      }
    };

    const result = (await handler(
      buildAthleteEvent(JSON.stringify(invalidBackup)),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INCOMPATIBLE_BACKUP_SCHEMA');
    expect(body.error.message).toContain('Unsupported backup schema version');
    expect(mockBatchWriteItems).not.toHaveBeenCalled();
  });

  it('rejects malformed backup format before writing', async () => {
    const malformedBackup = {
      schemaVersion: '2026-02-27',
      generatedAt: '2026-02-26T00:00:00.000Z',
      full: {
        athleteId: 'athlete-1',
        entries: {},
        comments: [],
        links: [],
        aiThreads: [],
        aiMessages: []
      }
    };

    const result = (await handler(
      buildAthleteEvent(JSON.stringify(malformedBackup)),
      {} as never,
      () => undefined
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_BACKUP_FORMAT');
    expect(body.error.message).toContain('full.entries');
    expect(mockBatchWriteItems).not.toHaveBeenCalled();
  });
});
