import { api } from '../../lib/api';
import type { FileItem } from '../../types';

export interface FileChunk {
  id: string;
  text: string;
  chunkIndex: number;
}

export const filesApi = {
  list: (projectId?: string) => api.get<{ files: FileItem[] }>(`/files${projectId ? `?projectId=${projectId}` : ''}`),

  upload: (file: File, projectId?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (projectId) form.append('projectId', projectId);
    return api.post<{ file: { id: string; filename: string; status: string } }>('/files', form);
  },

  get: (fileId: string) =>
    api.get<{ id: string; filename: string; status: string; failureReason: string | null; downloadUrl: string }>(
      `/files/${fileId}`
    ),

  getChunks: (fileId: string) => api.get<{ chunks: FileChunk[] }>(`/files/${fileId}/chunks`),
};
