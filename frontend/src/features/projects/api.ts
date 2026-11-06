import { api } from '../../lib/api';
import type { Project, ProjectSource } from '../../types';
import { listQuery } from '../../lib/listQuery';

export interface ProjectMember {
  userId: string;
  email: string;
  name: string;
  joinedAt: string;
}

export interface WhatsAppMemoryChunk {
  id: string;
  sourceType: 'whatsapp' | 'email' | 'cheerio';
  text: string;
  chatName: string | null;
  chatJid: string | null;
  sender: string | null;
  messageTimestamp: string | null;
  createdAt: string;
}

export type MemorySource = WhatsAppMemoryChunk['sourceType'];
export type MemoryCounts = Record<MemorySource, number>;

export const projectsApi = {
  list: () => api.get<{ projects: Project[] }>('/projects'),

  get: (projectId: string) => api.get<{ project: Project }>(`/projects/${projectId}`),

  create: (values: { name: string; description?: string; websiteUrl?: string }) => api.post<{ project: Project }>('/projects', values),

  update: (projectId: string, values: { name?: string; description?: string; websiteUrl?: string }) =>
    api.patch<{ project: Project }>(`/projects/${projectId}`, values),

  delete: (projectId: string) => api.delete<{ message: string }>(`/projects/${projectId}`),

  listMembers: (projectId: string) => api.get<{ members: ProjectMember[] }>(`/projects/${projectId}/members`),

  addMember: (projectId: string, userId: string) =>
    api.post<{ message: string }>(`/projects/${projectId}/members`, { userId }),

  removeMember: (projectId: string, userId: string) =>
    api.delete<{ message: string }>(`/projects/${projectId}/members/${userId}`),

  listSources: (projectId: string) => api.get<{ sources: ProjectSource[] }>(`/projects/${projectId}/sources`),

  addSource: (projectId: string, integrationId: string, chatJid?: string) =>
    api.post<{ source: { id: string; chatName: string } }>(`/projects/${projectId}/sources`, {
      integrationId,
      chatJid,
    }),

  removeSource: (projectId: string, sourceId: string) =>
    api.delete<{ message: string }>(`/projects/${projectId}/sources/${sourceId}`),

  /** One page of knowledge, newest first. `counts` comes back on the first page only. */
  listWhatsAppMemory: (projectId: string, params: { source?: MemorySource | null; q?: string; before?: string | null; limit?: number } = {}) =>
    api.get<{ chunks: WhatsAppMemoryChunk[]; hasMore: boolean; counts?: MemoryCounts }>(
      `/projects/${projectId}/whatsapp-memory${listQuery({ ...params })}`
    ),

  updateChunk: (projectId: string, chunkId: string, text: string) =>
    api.patch<{ chunk: { id: string; text: string } }>(`/projects/${projectId}/chunks/${chunkId}`, { text }),

  deleteChunk: (projectId: string, chunkId: string) =>
    api.delete<{ message: string }>(`/projects/${projectId}/chunks/${chunkId}`),
};
