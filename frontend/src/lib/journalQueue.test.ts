import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enqueueOfflineCreate, enqueueOfflineUpdate, readOfflineMutationQueue } from './journalLocal';
import { flushOfflineMutationQueue, retryFailedOfflineMutations } from './journalQueue';

const { apiClientMock } = vi.hoisted(() => ({
  apiClientMock: {
    createEntry: vi.fn(),
    getEntry: vi.fn(),
    updateEntry: vi.fn(),
  },
}));

vi.mock('@/lib/apiClient', () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  apiClient: apiClientMock,
}));

const payload = {
  sections: { shared: 'shared', private: '' },
  sessionMetrics: { durationMinutes: 60, intensity: 6, rounds: 5, giOrNoGi: 'gi' as const, tags: [] },
  rawTechniqueMentions: [],
  mediaAttachments: [],
};

describe('journalQueue', () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiClientMock.createEntry.mockReset();
    apiClientMock.getEntry.mockReset();
    apiClientMock.updateEntry.mockReset();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  it('flushes queued create and update mutations and removes them from queue', async () => {
    enqueueOfflineCreate(payload);
    enqueueOfflineUpdate('entry-1', payload, '2026-02-26T00:00:00.000Z');

    apiClientMock.createEntry.mockResolvedValue({ entryId: 'created-1' });
    apiClientMock.getEntry.mockResolvedValue({
      entryId: 'entry-1',
      createdAt: '2026-02-20T00:00:00.000Z',
      updatedAt: '2026-02-26T00:00:00.000Z',
    });
    apiClientMock.updateEntry.mockResolvedValue({ entryId: 'entry-1' });

    const result = await flushOfflineMutationQueue();

    expect(result).toMatchObject({
      processed: 2,
      succeeded: 2,
      failed: 0,
      conflicts: 0,
      remainingPending: 0,
      remainingFailed: 0,
    });
    expect(readOfflineMutationQueue()).toEqual([]);
  });

  it('keeps mutation pending when network is unavailable', async () => {
    enqueueOfflineCreate(payload);
    apiClientMock.createEntry.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await flushOfflineMutationQueue();

    expect(result.succeeded).toBe(0);
    expect(result.remainingPending).toBe(1);
    const queue = readOfflineMutationQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.status).toBe('pending');
  });

  it('marks queued updates as failed on conflict when server version changed', async () => {
    enqueueOfflineUpdate('entry-2', payload, '2026-02-25T00:00:00.000Z');
    apiClientMock.getEntry.mockResolvedValue({
      entryId: 'entry-2',
      createdAt: '2026-02-20T00:00:00.000Z',
      updatedAt: '2026-02-27T00:00:00.000Z',
    });

    const result = await flushOfflineMutationQueue();

    expect(result).toMatchObject({
      processed: 1,
      succeeded: 0,
      failed: 1,
      conflicts: 1,
      remainingPending: 0,
      remainingFailed: 1,
    });

    const queue = readOfflineMutationQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      mutationType: 'update',
      status: 'failed',
      failureReason: 'conflict',
    });
    expect(apiClientMock.updateEntry).not.toHaveBeenCalled();
  });

  it('retries failed mutations when requested manually', async () => {
    enqueueOfflineCreate(payload);
    window.localStorage.setItem(
      'journal.offlineMutationQueue.v1',
      JSON.stringify(
        readOfflineMutationQueue().map((item) => ({
          ...item,
          status: 'failed',
          failureReason: 'unknown',
        })),
      ),
    );

    apiClientMock.createEntry.mockResolvedValue({ entryId: 'created-2' });

    const result = await retryFailedOfflineMutations();

    expect(result.succeeded).toBe(1);
    expect(result.remainingFailed).toBe(0);
    expect(readOfflineMutationQueue()).toEqual([]);
  });
});
