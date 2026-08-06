import { create } from 'zustand';
import type { ActiveOrg, OrgMembershipSummary, User } from '../types';

interface AuthState {
  token: string | null;
  user: User | null;
  activeOrg: ActiveOrg | null;
  orgs: OrgMembershipSummary[];
  setSession: (data: { token: string; user?: User; activeOrg?: ActiveOrg | null }) => void;
  setOrgs: (orgs: OrgMembershipSummary[]) => void;
  setActiveOrg: (org: ActiveOrg) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

const storedToken = localStorage.getItem('quark_token');

export const useAuthStore = create<AuthState>((set) => ({
  token: storedToken,
  user: null,
  activeOrg: null,
  orgs: [],

  setSession: ({ token, user, activeOrg }) => {
    localStorage.setItem('quark_token', token);
    if (activeOrg) localStorage.setItem('quark_active_org', activeOrg.orgId);
    set((state) => ({
      token,
      user: user ?? state.user,
      activeOrg: activeOrg ?? state.activeOrg,
    }));
  },

  setOrgs: (orgs) => set({ orgs }),

  setUser: (user) => set({ user }),

  setActiveOrg: (org) => {
    localStorage.setItem('quark_active_org', org.orgId);
    set({ activeOrg: org });
  },

  logout: () => {
    localStorage.removeItem('quark_token');
    localStorage.removeItem('quark_active_org');
    set({ token: null, user: null, activeOrg: null, orgs: [] });
  },
}));
