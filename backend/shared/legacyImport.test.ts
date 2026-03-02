import { queryItems } from './db';
import { buildLegacyImportPreview, finalizeLegacyImportEntry } from './legacyImport';

jest.mock('./db');

const mockQueryItems = jest.mocked(queryItems);

describe('legacyImport', () => {
  beforeEach(() => {
    mockQueryItems.mockReset();
    mockQueryItems.mockResolvedValue({ Items: [] } as never);
  });

  it('builds markdown preview with source traceability and confidence flags', async () => {
    const preview = await buildLegacyImportPreview('athlete-1', {
      sourceType: 'markdown',
      sourceTitle: 'Old class notes',
      rawContent: `---\ndate: 2026-01-20\nclass: Fundamentals\ngym: North\nrounds: 5\n---\n# Notes\nWorked knee cut pass and got swept after overcommitting. Cue: frame first.`,
      useGpt: false,
    });

    expect(preview.source.sourceType).toBe('markdown');
    expect(preview.source.contentHash).toBeTruthy();
    expect(preview.draftEntry.quickAdd.class).toBe('Fundamentals');
    expect(preview.structuredExtraction.suggestions.length).toBeGreaterThan(0);
  });

  it('flags duplicate source content using import source hash', async () => {
    const firstPreview = await buildLegacyImportPreview('athlete-1', {
      sourceType: 'markdown',
      rawContent: '# Same note\nKnee cut pass rounds.',
      useGpt: false,
    });

    mockQueryItems.mockResolvedValueOnce({
      Items: [
        {
          PK: 'USER#athlete-1',
          SK: 'ENTRY#2026-01-20T00:00:00.000Z#entry-1',
          entityType: 'ENTRY',
          entryId: 'entry-1',
          athleteId: 'athlete-1',
          createdAt: '2026-01-20T00:00:00.000Z',
          updatedAt: '2026-01-20T00:00:00.000Z',
          quickAdd: {
            time: '2026-01-20T00:00:00.000Z',
            class: 'Fundamentals',
            gym: 'North',
            partners: [],
            rounds: 3,
            notes: 'Knee cut pass rounds.',
          },
          tags: ['pass'],
          sections: { shared: 'Knee cut pass rounds.', private: '' },
          sessionMetrics: {
            durationMinutes: 60,
            intensity: 6,
            rounds: 3,
            giOrNoGi: 'gi',
            tags: ['pass'],
          },
          rawTechniqueMentions: ['Knee cut pass'],
          importMetadata: {
            importId: 'import-1',
            mode: 'heuristic',
            source: {
              sourceType: 'markdown',
              capturedAt: '2026-01-20T00:00:00.000Z',
              contentHash: firstPreview.source.contentHash,
            },
            dedupStatus: 'override-imported',
            conflictStatus: 'none',
            requiresCoachReview: false,
          },
        },
      ],
    } as never);

    const duplicatePreview = await buildLegacyImportPreview('athlete-1', {
      sourceType: 'markdown',
      rawContent: '# Same note\nKnee cut pass rounds.',
      useGpt: false,
    });

    expect(duplicatePreview.dedupStatus).toBe('duplicate-source');
    expect(duplicatePreview.duplicateEntryIds).toEqual(['entry-1']);
  });

  it('finalizes corrected preview into entry with import metadata', () => {
    const nowIso = '2026-03-01T00:00:00.000Z';
    const entry = finalizeLegacyImportEntry(
      'athlete-1',
      {
        preview: {
          importId: 'import-1',
          mode: 'heuristic',
          draftEntry: {
            quickAdd: {
              time: nowIso,
              class: 'Imported class',
              gym: 'North',
              partners: [],
              rounds: 3,
              notes: 'Half guard bottom notes',
            },
            tags: ['guard-type'],
            sections: { shared: 'Half guard', private: 'private' },
            sessionMetrics: {
              durationMinutes: 45,
              intensity: 7,
              rounds: 3,
              giOrNoGi: 'gi',
              tags: ['guard-type'],
            },
            rawTechniqueMentions: ['Knee shield'],
          },
          structuredExtraction: {
            generatedAt: nowIso,
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
            capturedAt: nowIso,
            contentHash: 'abc',
          },
          warnings: [],
        },
        duplicateResolution: 'allow',
        conflictResolution: 'commit',
        corrections: {
          structured: {
            technique: 'knee shield recovery',
          },
          requiresCoachReview: true,
          coachReview: {
            requiresReview: true,
            coachNotes: 'Verify before publishing',
            reviewedAt: nowIso,
          },
        },
      },
      { nowIso },
    );

    expect(entry.importMetadata?.importId).toBe('import-1');
    expect(entry.importMetadata?.requiresCoachReview).toBe(true);
    expect(entry.importMetadata?.source.contentHash).toBe('abc');
    expect(entry.structured?.technique).toBe('knee shield recovery');
  });
});
