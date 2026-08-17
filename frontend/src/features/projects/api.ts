import { api } from '../../lib/api';
import type { Project, ProjectSource } from '../../types';

export interface ProjectMember {
  userId: string;
  email: string;
  name: string;
  joinedAt: string;
}

export interface WhatsAppMemoryChunk {
  id: string;
  text: string;
  chatName: string | null;
  chatJid: string | null;
  sender: string | null;
  messageTimestamp: string | null;
}

export const projectsApi = {
  list: () => api.get<{ projects: Project[] }>('/projects'),

  get: (projectId: string) => api.get<{ project: Project }>(`/projects/${projectId}`),

  create: (name: string, description = '') => api.post<{ project: Project }>('/projects', { name, description }),

  update: (projectId: string, values: { name?: string; description?: string }) =>
    api.patch<{ project: Project }>(`/projects/${projectId}`, values),

  delete: (projectId: string) => api.delete<{ message: string }>(`/projects/${projectId}`),

  listMembers: (projectId: string) => api.get<{ members: ProjectMember[] }>(`/projects/${projectId}/members`),

  addMember: (projectId: string, userId: string) =>
    api.post<{ message: string }>(`/projects/${projectId}/members`, { userId }),

  removeMember: (projectId: string, userId: string) =>
    api.delete<{ message: string }>(`/projects/${projectId}/members/${userId}`),

  listSources: (projectId: string) => api.get<{ sources: ProjectSource[] }>(`/projects/${projectId}/sources`),

  addSource: (projectId: string, integrationId: string, chatJid: string) =>
    api.post<{ source: { id: string; chatName: string } }>(`/projects/${projectId}/sources`, {
      integrationId,
      chatJid,
    }),

  removeSource: (projectId: string, sourceId: string) =>
    api.delete<{ message: string }>(`/projects/${projectId}/sources/${sourceId}`),

  listWhatsAppMemory: (projectId: string) =>
    api.get<{ chunks: WhatsAppMemoryChunk[] }>(`/projects/${projectId}/whatsapp-memory`),
};
