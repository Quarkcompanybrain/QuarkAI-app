import { api, API_URL } from '../../lib/api';
import type { Integration, WhatsAppChat } from '../../types';

export const integrationsApi = {
  list: () => api.get<{ integrations: Integration[] }>('/integrations'),

  connectWhatsapp: () => api.post<{ integration: Integration }>('/integrations/whatsapp/connect'),

  connectEmail: (values: { email: string; password: string; host?: string; port?: number; username?: string }) =>
    api.post<{ integration: Integration }>('/integrations/email/connect', values),

  connectCheerio: (values: { name: string }) => api.post<{ integration: Integration }>('/integrations/cheerio/connect', values),

  disconnect: (id: string) => api.delete<{ message: string }>(`/integrations/${id}`),

  getGoogleWorkspace: () => api.get<{ configured: boolean; serviceAccountEmail: string | null }>('/integrations/google'),

  listChats: (id: string) => api.get<{ chats: WhatsAppChat[] }>(`/integrations/${id}/chats`),
};

interface ConnectionStreamHandlers {
  onQr: (qrDataUrl: string) => void;
  onConnected: (phoneNumber: string | null) => void;
  onDisconnected: () => void;
}

/**
 * Consumes the connection-lifecycle SSE stream directly over fetch — same
 * pattern as chat streaming, no EventSource/extra library needed.
 */
export async function streamIntegrationStatus(integrationId: string, handlers: ConnectionStreamHandlers) {
  const token = localStorage.getItem('quark_token');
  const orgId = localStorage.getItem('quark_active_org');

  const res = await fetch(`${API_URL}/integrations/${integrationId}/stream`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'x-org-id': orgId } : {}),
    },
  });

  if (!res.ok || !res.body) return;

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

      if (eventName === 'qr') handlers.onQr(data.qrDataUrl);
      else if (eventName === 'connected') handlers.onConnected(data.phoneNumber ?? null);
      else if (eventName === 'disconnected') handlers.onDisconnected();
    }
  }
}
