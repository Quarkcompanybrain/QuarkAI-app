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
  description: string;
  websiteUrl?: string;
  createdBy: string;
  createdAt: string;
  canManageMemory?: boolean;
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

export type IntegrationStatus = 'pending' | 'connected' | 'disconnected' | 'failed';

export interface Integration {
  id: string;
  type: 'whatsapp';
  status: IntegrationStatus;
  phoneNumber: string | null;
  lastConnectedAt: string | null;
}

export interface WhatsAppChat {
  jid: string;
  name: string;
  isGroup: boolean;
  lastMessageAt: string | null;
  lastMessageId?: string | null;
  lastMessageText?: string | null;
  lastMessageType?: string | null;
  lastMessageFromMe?: boolean;
  hasIngestedMessages?: boolean;
  ingestedMessageCount?: number;
  linkedProjectIds?: string[];
  lastIngestedAt?: string | null;
  lastMemoryChunkIds?: string[];
}

export interface ProjectSource {
  id: string;
  sourceType: 'whatsapp';
  integrationId: string;
  chatJid: string;
  chatName: string;
  isGroup: boolean;
  addedBy: string;
}
