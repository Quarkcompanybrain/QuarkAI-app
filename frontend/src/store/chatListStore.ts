import { create } from 'zustand';

/**
 * A bare version counter ChatPanel bumps after an async event the sidebar's
 * recent-chats list can't otherwise detect (e.g. auto-titling, which
 * completes without a URL/route change). AppShell just needs to know
 * "something changed, refetch" — no payload required.
 */
interface ChatListState {
  version: number;
  bump: () => void;
}

export const useChatListStore = create<ChatListState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
