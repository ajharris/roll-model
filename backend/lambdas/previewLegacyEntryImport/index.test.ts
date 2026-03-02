import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { buildLegacyImportPreview } from '../../shared/legacyImport';

import { handler } from './index';

jest.mock('../../shared/legacyImport');

const mockBuildLegacyImportPreview = jest.mocked(buildLegacyImportPreview);

const buildEvent = (role: 'athlete' | 'coach', body: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        claims: {
          sub: role === 'athlete' ? 'athlete-1' : 'coach-1',
          'custom:role': role,
        },
      },
    },
  }) as unknown as APIGatewayProxyEvent;

describe('previewLegacyEntryImport handler', () => {
  beforeEach(() => {
    mockBuildLegacyImportPreview.mockReset();
  });

  it('returns preview for athlete requests', async () => {
    mockBuildLegacyImportPreview.mockResolvedValue({
      importId: 'import-1',
      mode: 'heuristic',
      draftEntry: {
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
        rawTechniqueMentions: [],
      },
      structuredExtraction: {
        generatedAt: '2026-03-01T00:00:00.000Z',
        suggestions: [],
        concepts: [],
        failures: [],
        conditioningIssues: [],
        confidenceFlags: [],
      },
      confidenceFlags: [],
      dedupStatus: 'new',
      duplicateEntryIds: [],
      conflictStatus: 'none',
      requiresCoachReview: false,
      source: {
        sourceType: 'markdown',
        capturedAt: '2026-03-01T00:00:00.000Z',
        contentHash: 'hash',
      },
      warnings: [],
    });

    const result = (await handler(
      buildEvent('athlete', { sourceType: 'markdown', rawContent: '# notes' }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockBuildLegacyImportPreview).toHaveBeenCalledWith(
      'athlete-1',
      expect.objectContaining({ sourceType: 'markdown' }),
    );
  });

  it('rejects coach role', async () => {
    const result = (await handler(
      buildEvent('coach', { sourceType: 'markdown', rawContent: '# notes' }),
      {} as never,
      () => undefined,
    )) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(403);
    expect(mockBuildLegacyImportPreview).not.toHaveBeenCalled();
  });
});
