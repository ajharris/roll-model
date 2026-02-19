import { getItem, putItem } from './db';
import { __test__, upsertTechniqueCandidates } from './techniques';

jest.mock('./db');

const mockGetItem = jest.mocked(getItem);
const mockPutItem = jest.mocked(putItem);

describe('technique candidates', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockPutItem.mockReset();
    mockPutItem.mockResolvedValue();
  });

  it('increments counts and caps example entry ids', async () => {
    const cap = __test__.MAX_EXAMPLE_ENTRY_IDS;
    const existingExamples = Array.from({ length: cap }, (_, index) => `entry-${index}`);

    mockGetItem.mockResolvedValue({
      Item: {
        PK: 'TECHNIQUE_CANDIDATE',
        SK: 'arm-bar',
        entityType: 'TECHNIQUE_CANDIDATE',
        phrase: 'Arm Bar',
        normalizedPhrase: 'arm-bar',
        count: 2,
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        exampleEntryIds: existingExamples,
        status: 'unmapped'
      }
    } as never);

    await upsertTechniqueCandidates(['Arm Bar'], 'entry-new', '2026-01-02T00:00:00.000Z');

    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(mockPutItem).toHaveBeenCalledTimes(1);

    const payload = mockPutItem.mock.calls[0][0] as { Item: Record<string, unknown> };
    expect(payload.Item.count).toBe(3);
    expect(payload.Item.phrase).toBe('Arm Bar');
    expect(payload.Item.normalizedPhrase).toBe('arm-bar');
    expect(payload.Item.exampleEntryIds).toHaveLength(cap);
    expect((payload.Item.exampleEntryIds as string[])[cap - 1]).toBe('entry-new');
  });
});
