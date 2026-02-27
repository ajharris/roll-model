'use client';

import { ApiError, apiClient } from '@/lib/apiClient';
import {
  type OfflineMutationFailureReason,
  type OfflineMutationQueueItem,
  getOfflineMutationQueueCounts,
  readOfflineMutationQueue,
  removeOfflineMutationQueueItem,
  updateOfflineMutationQueueItem,
} from '@/lib/journalLocal';

export interface OfflineQueueFlushResult {
  processed: number;
  succeeded: number;
  failed: number;
  conflicts: number;
  remainingPending: number;
  remainingFailed: number;
}

const isLikelyOffline = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine === false : false;

const shouldTreatAsNetworkFailure = (error: unknown): boolean => {
  if (isLikelyOffline()) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof ApiError) return error.status >= 500;
  return false;
};

const getFailureClassification = (
  error: unknown,
): { reason: OfflineMutationFailureReason; message: string; retryable: boolean } => {
  if (shouldTreatAsNetworkFailure(error)) {
    return {
      reason: 'network',
      message: 'Network unavailable. Will retry automatically when online.',
      retryable: true,
    };
  }

  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        reason: 'unauthorized',
        message: 'Authentication expired. Sign in again, then retry sync.',
        retryable: false,
      };
    }
    if (error.status === 404) {
      return {
        reason: 'not-found',
        message: 'Entry was not found on the server.',
        retryable: false,
      };
    }
    if (error.status === 400 || error.status === 422) {
      return {
        reason: 'validation',
        message: 'Server rejected this payload. Open the entry and resave before retrying.',
        retryable: false,
      };
    }
  }

  return {
    reason: 'unknown',
    message: 'Sync failed. Retry manually.',
    retryable: false,
  };
};

const markPendingAttempt = (item: OfflineMutationQueueItem) => {
  const now = new Date().toISOString();
  updateOfflineMutationQueueItem(item.queueId, (candidate) => ({
    ...candidate,
    status: 'pending',
    attemptCount: candidate.attemptCount + 1,
    lastAttemptAt: now,
    updatedAt: now,
    failureReason: undefined,
    errorMessage: undefined,
  }));
};

const markPendingRetry = (item: OfflineMutationQueueItem) => {
  const now = new Date().toISOString();
  updateOfflineMutationQueueItem(item.queueId, (candidate) => ({
    ...candidate,
    status: 'pending',
    lastAttemptAt: now,
    updatedAt: now,
  }));
};

const markFailed = (item: OfflineMutationQueueItem, reason: OfflineMutationFailureReason, errorMessage: string) => {
  const now = new Date().toISOString();
  updateOfflineMutationQueueItem(item.queueId, (candidate) => ({
    ...candidate,
    status: 'failed',
    lastAttemptAt: now,
    updatedAt: now,
    failureReason: reason,
    errorMessage,
  }));
};

const runOneMutation = async (item: OfflineMutationQueueItem): Promise<{ conflict: boolean }> => {
  if (item.mutationType === 'create') {
    await apiClient.createEntry(item.payload);
    return { conflict: false };
  }

  if (item.baseUpdatedAt) {
    const current = await apiClient.getEntry(item.entryId);
    const currentVersion = current.updatedAt ?? current.createdAt;
    if (currentVersion !== item.baseUpdatedAt) {
      markFailed(
        item,
        'conflict',
        'Server entry changed after you started editing. Open the entry, review latest state, and save again.',
      );
      return { conflict: true };
    }
  }

  await apiClient.updateEntry(item.entryId, item.payload);
  return { conflict: false };
};

let inFlightFlush: Promise<OfflineQueueFlushResult> | null = null;

const flushInternal = async (options: { includeFailed: boolean }): Promise<OfflineQueueFlushResult> => {
  const queue = readOfflineMutationQueue();
  const eligible = queue.filter((item) => item.status === 'pending' || options.includeFailed);

  if (eligible.length === 0) {
    const counts = getOfflineMutationQueueCounts();
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      conflicts: 0,
      remainingPending: counts.pending,
      remainingFailed: counts.failed,
    };
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let conflicts = 0;

  for (const item of eligible) {
    markPendingAttempt(item);
    processed += 1;

    try {
      const result = await runOneMutation(item);
      if (result.conflict) {
        failed += 1;
        conflicts += 1;
        continue;
      }
      removeOfflineMutationQueueItem(item.queueId);
      succeeded += 1;
    } catch (error) {
      const classification = getFailureClassification(error);
      if (classification.retryable) {
        markPendingRetry(item);
        break;
      }
      markFailed(item, classification.reason, classification.message);
      failed += 1;
    }
  }

  const counts = getOfflineMutationQueueCounts();
  return {
    processed,
    succeeded,
    failed,
    conflicts,
    remainingPending: counts.pending,
    remainingFailed: counts.failed,
  };
};

export const flushOfflineMutationQueue = async (): Promise<OfflineQueueFlushResult> => {
  if (inFlightFlush) return inFlightFlush;
  inFlightFlush = flushInternal({ includeFailed: false });

  try {
    return await inFlightFlush;
  } finally {
    inFlightFlush = null;
  }
};

export const retryFailedOfflineMutations = async (): Promise<OfflineQueueFlushResult> => {
  return flushInternal({ includeFailed: true });
};

// Backward-compatible export used by existing pages/tests.
export const flushOfflineCreateQueue = flushOfflineMutationQueue;
