import { api } from '../../lib/api';
import type { ActiveOrg, OrgMembershipSummary, User } from '../../types';

interface AuthResponse {
  token: string;
  user?: User;
  activeOrg: ActiveOrg | null;
}

export const authApi = {
  requestSignupOtp: (email: string) => api.post<{ message: string }>('/auth/signup/request-otp', { email }),

  verifySignupOtp: (data: { email: string; code: string; name: string; password: string }) =>
    api.post<AuthResponse>('/auth/signup/verify', data),

  login: (data: { email: string; password: string }) => api.post<AuthResponse>('/auth/login', data),

  me: () => api.get<{ user: User; orgs: OrgMembershipSummary[] }>('/auth/me'),

  switchOrg: (orgId: string) => api.post<AuthResponse>('/auth/switch-org', { orgId }),

  updateProfile: (name: string) => api.patch<{ user: User }>('/auth/me', { name }),

  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('avatar', file);
    return api.post<{ user: User }>('/auth/me/avatar', form);
  },

  requestPasswordReset: (email: string) =>
    api.post<{ message: string }>('/auth/forgot-password/request-otp', { email }),

  resetPassword: (data: { email: string; code: string; newPassword: string }) =>
    api.post<{ message: string }>('/auth/forgot-password/reset', data),
};
