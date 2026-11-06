import { api } from '../../lib/api';
import type { FileItem } from '../../types';
import { listQuery } from '../../lib/listQuery';

export interface FileChunk {
  id: string;
  text: string;
  chunkIndex: number;
}

export type FileSourceFilter = 'upload' | 'whatsapp' | 'email';

export interface FileCounts {
  upload: number;
  whatsapp: number;
  email: number;
  failed: number;
}

export interface FileListParams {
  projectId?: string;
  source?: FileSourceFilter | null;
  status?: 'failed' | null;
  q?: string;
  before?: string | null;
  limit?: number;
}

export const filesApi = {
  /** One page, newest first. `counts` comes back on the first page only. */
  list: (params: FileListParams = {}) =>
    api.get<{ files: FileItem[]; hasMore: boolean; counts?: FileCounts }>(`/files${listQuery({ ...params })}`),

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
