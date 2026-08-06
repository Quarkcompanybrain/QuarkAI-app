export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface OrgMembershipSummary {
  orgId: string;
  name: string;
  role: 'admin' | 'member';
}

export interface ActiveOrg {
  orgId: string;
  role: 'admin' | 'member';
}

export interface Project {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

export type FileStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface FileItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: FileStatus;
  failureReason: string | null;
  createdAt: string;
}

export type ChatScope = 'personal' | 'project';

export interface ChatSessionSummary {
  id: string;
  scope: ChatScope;
  projectId: string | null;
  projectName: string | null;
  title: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
