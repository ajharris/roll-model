'use client';

import { apiClient } from '@/lib/apiClient';
import { readOfflineCreateQueue, writeOfflineCreateQueue } from '@/lib/journalLocal';

let inFlightFlush: Promise<number> | null = null;

export const flushOfflineCreateQueue = async (): Promise<number> => {
  if (inFlightFlush) return inFlightFlush;

  inFlightFlush = (async () => {
    const queue = readOfflineCreateQueue();
    if (queue.length === 0) return 0;

    let flushed = 0;
    let remaining = [...queue];

    for (const item of queue) {
      try {
        await apiClient.createEntry(item.payload);
        flushed += 1;
        remaining = remaining.filter((candidate) => candidate.queueId !== item.queueId);
        writeOfflineCreateQueue(remaining);
      } catch {
        break;
      }
    }

    return flushed;
  })();

  try {
    return await inFlightFlush;
  } finally {
    inFlightFlush = null;
  }
};
