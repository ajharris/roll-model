import {
  CURRENT_ENTRY_SCHEMA_VERSION,
  isValidClipTimestamp,
  isValidMediaAttachmentsInput,
  isValidMediaUrl,
  normalizeEntry,
  parseEntryRecord,
  withCurrentEntrySchemaVersion
} from './entries';

describe('entry schema versioning', () => {
  it('stamps the current schema version for new entries', () => {
    const entry = withCurrentEntrySchemaVersion({
      entryId: 'entry-1',
      athleteId: 'athlete-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      quickAdd: {
        time: '2024-01-01T18:00:00.000Z',
        class: 'Open mat',
        gym: 'North Academy',
        partners: ['Alex'],
        rounds: 6,
        notes: 'shared'
      },
      tags: ['guard-type'],
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
    expect(entry.quickAdd.notes).toBe('shared');
    expect(entry.tags).toEqual([]);
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
      quickAdd: {
        time: '2024-01-01T18:00:00.000Z',
        class: 'Open mat',
        gym: 'North Academy',
        partners: ['Alex'],
        rounds: 6,
        notes: 'shared'
      },
      tags: ['guard-type'],
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

  it('validates media urls and clip timestamps', () => {
    expect(isValidMediaUrl('https://example.com/video')).toBe(true);
    expect(isValidMediaUrl('ftp://example.com/video')).toBe(false);
    expect(isValidClipTimestamp('0:32')).toBe(true);
    expect(isValidClipTimestamp('1:02:03')).toBe(true);
    expect(isValidClipTimestamp('00:3')).toBe(false);
  });

  it('accepts ordered timestamped clip notes and rejects malformed media payloads', () => {
    expect(
      isValidMediaAttachmentsInput([
        {
          mediaId: 'media-1',
          title: 'Round 1',
          url: 'https://example.com/video',
          clipNotes: [
            { clipId: 'clip-1', timestamp: '0:32', text: 'Frame was late' },
            { clipId: 'clip-2', timestamp: '1:18', text: 'Hip escape timing improved' }
          ]
        }
      ])
    ).toBe(true);

    expect(
      isValidMediaAttachmentsInput([
        {
          mediaId: 'media-1',
          title: 'Round 1',
          url: 'example.com/video',
          clipNotes: [{ clipId: 'clip-1', timestamp: '0:32', text: 'Frame was late' }]
        }
      ])
    ).toBe(false);

    expect(
      isValidMediaAttachmentsInput([
        {
          mediaId: 'media-1',
          title: 'Round 1',
          url: 'https://example.com/video',
          clipNotes: [{ clipId: 'clip-1', timestamp: '32', text: 'Frame was late' }]
        }
      ])
    ).toBe(false);
  });

  it('normalizes stored session review one-thing cue', () => {
    const entry = parseEntryRecord({
      PK: 'USER#athlete-1',
      SK: 'ENTRY#2024-01-01T00:00:00.000Z#entry-1',
      entityType: 'ENTRY',
      entryId: 'entry-1',
      athleteId: 'athlete-1',
      schemaVersion: 3,
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
      rawTechniqueMentions: [],
      sessionReviewDraft: {
        promptSet: {
          whatWorked: ['Frames'],
          whatFailed: ['Late pummel'],
          whatToAskCoach: ['Ask'],
          whatToDrillSolo: ['Drill']
        },
        oneThing: '  Pummel first. Then reset. ',
        confidenceFlags: []
      }
    });

    expect(entry.sessionReviewDraft?.oneThing).toBe('Pummel first');
  });
});
