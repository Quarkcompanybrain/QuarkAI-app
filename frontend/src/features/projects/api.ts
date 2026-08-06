import { api } from '../../lib/api';
import type { Project } from '../../types';

export interface ProjectMember {
  userId: string;
  email: string;
  name: string;
  joinedAt: string;
}

export const projectsApi = {
  list: () => api.get<{ projects: Project[] }>('/projects'),

  get: (projectId: string) => api.get<{ project: Project }>(`/projects/${projectId}`),

  create: (name: string) => api.post<{ project: Project }>('/projects', { name }),

  update: (projectId: string, name: string) =>
    api.patch<{ project: Project }>(`/projects/${projectId}`, { name }),

  listMembers: (projectId: string) => api.get<{ members: ProjectMember[] }>(`/projects/${projectId}/members`),

  addMember: (projectId: string, userId: string) =>
    api.post<{ message: string }>(`/projects/${projectId}/members`, { userId }),

  removeMember: (projectId: string, userId: string) =>
    api.delete<{ message: string }>(`/projects/${projectId}/members/${userId}`),
};
