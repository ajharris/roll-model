'use client';

import { useState } from 'react';
import { Protected } from '@/components/Protected';
import { ApiError, apiClient } from '@/lib/apiClient';
import { ChatThread } from '@/types/api';

const createThread = (): ChatThread => ({
  id: crypto.randomUUID(),
  title: 'New thread',
  messages: [],
});

export default function ChatPage() {
  const [threads, setThreads] = useState<ChatThread[]>([createThread()]);
  const [activeId, setActiveId] = useState(threads[0].id);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');

  const active = threads.find((thread) => thread.id === activeId)!;

  const send = async (prefill?: string) => {
    const message = (prefill ?? draft).trim();
    if (!message) return;
    const withUser = threads.map((thread) =>
      thread.id === active.id
        ? {
            ...thread,
            title: thread.messages.length ? thread.title : message.slice(0, 28),
            messages: [...thread.messages, { id: crypto.randomUUID(), role: 'user', text: message, createdAt: new Date().toISOString() }],
          }
        : thread,
    );
    setThreads(withUser);
    setDraft('');

    try {
      const response = await apiClient.chat({ threadId: active.id, message });
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === active.id
            ? {
                ...thread,
                messages: [...thread.messages, { id: crypto.randomUUID(), role: 'assistant', text: response.assistant_text, createdAt: new Date().toISOString() }],
              }
            : thread,
        ),
      );
      setStatus((response.suggested_prompts || []).join(' | '));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setStatus('Feature not available yet. /ai/chat is not deployed in this environment.');
      } else {
        setStatus('AI request failed.');
      }
    }
  };

  return (
    <Protected allow={['athlete']}>
      <section>
        <h2>Chat experiments</h2>
        <div className="thread-wrap">
          <div className="thread-list">
            <button onClick={() => {
              const thread = createThread();
              setThreads((prev) => [...prev, thread]);
              setActiveId(thread.id);
            }}>New thread</button>
            {threads.map((thread) => (
              <button key={thread.id} onClick={() => setActiveId(thread.id)}>{thread.title}</button>
            ))}
          </div>
          <div>
            <div className="messages">
              {active.messages.map((message) => (
                <p key={message.id}><strong>{message.role}</strong>: {message.text}</p>
              ))}
            </div>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button onClick={() => send()}>Send</button>
            {status && <p className="small">{status}</p>}
          </div>
        </div>
      </section>
    </Protected>
  );
}
