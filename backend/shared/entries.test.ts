import { CURRENT_ENTRY_SCHEMA_VERSION, normalizeEntry, parseEntryRecord, withCurrentEntrySchemaVersion } from './entries';

describe('entry schema versioning', () => {
  it('stamps the current schema version for new entries', () => {
    const entry = withCurrentEntrySchemaVersion({
      entryId: 'entry-1',
      athleteId: 'athlete-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      sections: { shared: 'shared', private: 'private' },
      sessionMetrics: {
        durationMinutes: 60,
        intensity: 7,
        rounds: 6,
        giOrNoGi: 'gi',
        tags: ['guard']
      },
      rawTechniqueMentions: ['Knee Slice']
    });

    expect(entry.schemaVersion).toBe(CURRENT_ENTRY_SCHEMA_VERSION);
  });

  it('migrates legacy entries without schemaVersion and rawTechniqueMentions', () => {
    const entry = normalizeEntry({
      entryId: 'entry-1',
      athleteId: 'athlete-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      sections: { shared: 'shared', private: 'private' },
      sessionMetrics: {
        durationMinutes: 60,
        intensity: 7,
        rounds: 6,
        giOrNoGi: 'gi',
        tags: ['guard']
      },
      rawTechniqueMentions: undefined
    });

    expect(entry.schemaVersion).toBe(CURRENT_ENTRY_SCHEMA_VERSION);
    expect(entry.rawTechniqueMentions).toEqual([]);
  });

  it('parses and migrates stored entry records', () => {
    const entry = parseEntryRecord({
      PK: 'USER#athlete-1',
      SK: 'ENTRY#2024-01-01T00:00:00.000Z#entry-1',
      entityType: 'ENTRY',
      entryId: 'entry-1',
      athleteId: 'athlete-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      sections: { shared: 'shared', private: 'private' },
      sessionMetrics: {
        durationMinutes: 60,
        intensity: 7,
        rounds: 6,
        giOrNoGi: 'gi',
        tags: ['guard']
      }
    });

    expect(entry.schemaVersion).toBe(CURRENT_ENTRY_SCHEMA_VERSION);
    expect(entry).not.toHaveProperty('PK');
    expect(entry).not.toHaveProperty('SK');
  });
});
