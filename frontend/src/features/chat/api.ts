import { api, API_URL } from '../../lib/api';
import type { ChatMessage, ChatScope, ChatSessionSummary } from '../../types';

export const chatApi = {
  createSession: (scope: ChatScope, projectId?: string) =>
    api.post<{ session: ChatSessionSummary }>('/chat/sessions', { scope, projectId }),

  listSessions: (scope?: ChatScope, projectId?: string) => {
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    if (projectId) params.set('projectId', projectId);
    const qs = params.toString();
    return api.get<{ sessions: ChatSessionSummary[] }>(`/chat/sessions${qs ? `?${qs}` : ''}`);
  },

  listMessages: (sessionId: string) => api.get<{ messages: ChatMessage[] }>(`/chat/sessions/${sessionId}/messages`),

  renameSession: (sessionId: string, title: string) =>
    api.patch<{ session: { id: string; title: string } }>(`/chat/sessions/${sessionId}`, { title }),
};

interface StreamHandlers {
  onToken: (delta: string) => void;
  onDone: (data: { sources: { id: string; filename: string; score: number }[]; title: string | null }) => void;
  onError: (message: string) => void;
}

/**
 * Consumes the backend's SSE stream directly over fetch — no EventSource,
 * no extra library, just reading response bytes as they arrive.
 */
export async function streamChatMessage(sessionId: string, message: string, handlers: StreamHandlers) {
  const token = localStorage.getItem('quark_token');
  const orgId = localStorage.getItem('quark_active_org');

  const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'x-org-id': orgId } : {}),
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({ error: 'Failed to send message.' }));
    handlers.onError(body.error || 'Failed to send message.');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const raw of events) {
      const eventLine = raw.split('\n').find((l) => l.startsWith('event: '));
      const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) continue;

      const eventName = eventLine.slice('event: '.length);
      const data = JSON.parse(dataLine.slice('data: '.length));

      if (eventName === 'token') handlers.onToken(data.delta);
      else if (eventName === 'done') handlers.onDone(data);
      else if (eventName === 'error') handlers.onError(data.message);
    }
  }
}
