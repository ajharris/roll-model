import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { batchWriteItems, putItem } from '../../shared/db';
import { finalizeLegacyImportEntry } from '../../shared/legacyImport';
import { recomputeAndPersistProgressViews } from '../../shared/progressStore';
import { upsertTechniqueCandidates } from '../../shared/techniques';

import { handler } from './index';

jest.mock('../../shared/db');
jest.mock('../../shared/legacyImport');
jest.mock('../../shared/progressStore', () => ({
  recomputeAndPersistProgressViews: jest.fn(),
}));
jest.mock('../../shared/techniques', () => ({
  ...jest.requireActual('../../shared/techniques'),
  upsertTechniqueCandidates: jest.fn(),
}));

const mockPutItem = jest.mocked(putItem);
const mockBatchWriteItems = jest.mocked(batchWriteItems);
const mockFinalizeLegacyImportEntry = jest.mocked(finalizeLegacyImportEntry);
const mockRecomputeAndPersistProgressViews = jest.mocked(recomputeAndPersistProgressViews);
const mockUpsertTechniqueCandidates = jest.mocked(upsertTechniqueCandidates);

const buildEvent = (body: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        claims: {
          sub: 'athlete-1',
          'custom:role': 'athlete',
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('commitLegacyEntryImport handler', () => {
  beforeEach(() => {
    mockPutItem.mockReset();
    mockBatchWriteItems.mockReset();
    mockFinalizeLegacyImportEntry.mockReset();
    mockRecomputeAndPersistProgressViews.mockReset();
    mockUpsertTechniqueCandidates.mockReset();

    mockPutItem.mockResolvedValue();
    mockBatchWriteItems.mockResolvedValue();
    mockRecomputeAndPersistProgressViews.mockResolvedValue({} as never);
    mockUpsertTechniqueCandidates.mockResolvedValue();
  });

  it('skips duplicate import when requested', async () => {
    const result = (await handler(
      buildEvent({
        preview: { dedupStatus: 'duplicate-source', duplicateEntryIds: ['entry-1'] },
        duplicateResolution: 'skip',
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockFinalizeLegacyImportEntry).not.toHaveBeenCalled();
    expect(mockPutItem).not.toHaveBeenCalled();
  });

  it('writes committed import entry', async () => {
    mockFinalizeLegacyImportEntry.mockReturnValue({
      entryId: 'entry-1',
      athleteId: 'athlete-1',
      schemaVersion: 5,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      quickAdd: {
        time: '2026-03-01T00:00:00.000Z',
        class: 'Imported',
        gym: 'North',
        partners: [],
        rounds: 0,
        notes: 'notes',
      },
      tags: [],
      sections: { shared: 's', private: 'p' },
      sessionMetrics: { durationMinutes: 60, intensity: 6, rounds: 0, giOrNoGi: 'gi', tags: [] },
      rawTechniqueMentions: ['knee cut'],
      structuredExtraction: {
        generatedAt: '2026-03-01T00:00:00.000Z',
        suggestions: [],
        concepts: [],
        failures: [],
        conditioningIssues: [],
        confidenceFlags: [],
      },
      importMetadata: {
        importId: 'import-1',
        mode: 'heuristic',
        source: { sourceType: 'markdown', capturedAt: '2026-03-01T00:00:00.000Z', contentHash: 'hash' },
        dedupStatus: 'override-imported',
        conflictStatus: 'none',
        requiresCoachReview: false,
      },
    });

    const result = (await handler(
      buildEvent({
        preview: { importId: 'import-1', dedupStatus: 'new', conflictStatus: 'none' },
        duplicateResolution: 'allow',
        conflictResolution: 'commit',
      }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(201);
    expect(mockFinalizeLegacyImportEntry).toHaveBeenCalled();
    expect(mockPutItem).toHaveBeenCalledTimes(2);
    expect(mockUpsertTechniqueCandidates).toHaveBeenCalledWith(['knee cut'], 'entry-1', expect.any(String));
  });
});
