import { api } from '../../lib/api';
import type { ActiveOrg } from '../../types';

export interface OrgMember {
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

export const orgApi = {
  create: (name: string) =>
    api.post<{ org: { id: string; name: string }; token: string; activeOrg: ActiveOrg }>('/orgs', { name }),

  listMembers: () => api.get<{ members: OrgMember[] }>('/orgs/members'),

  invite: (email: string) => api.post<{ message: string }>('/orgs/invites', { email }),

  listPendingInvites: () => api.get<{ invites: PendingInvite[] }>('/orgs/invites'),

  getInvite: (token: string) =>
    api.get<{ email: string; orgName: string; requiresPassword: boolean }>(`/orgs/invites/${token}`),

  acceptInvite: (token: string, data: { name?: string; password?: string }) =>
    api.post<{ token: string; activeOrg: ActiveOrg }>(`/orgs/invites/${token}/accept`, data),
};
