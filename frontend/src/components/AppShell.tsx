import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Logo } from './Logo';
import { OrgSwitcher } from './OrgSwitcher';
import { NewProjectButton } from './NewProjectButton';
import { useAuthStore } from '../store/authStore';
import { useChatListStore } from '../store/chatListStore';
import { projectsApi } from '../features/projects/api';
import { chatApi } from '../features/chat/api';
import { ChatBubbleIcon, FolderIcon, LogoutIcon, UserIcon, UsersIcon } from './icons';
import type { ChatSessionSummary, Project } from '../types';

const RECENT_CHATS_LIMIT = 5;

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, orgs, activeOrg, logout } = useAuthStore();
  const chatListVersion = useChatListStore((s) => s.version);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentChats, setRecentChats] = useState<ChatSessionSummary[]>([]);

  const refreshProjects = () => {
    projectsApi.list().then((r) => setProjects(r.projects)).catch(() => setProjects([]));
  };

  const refreshRecentChats = () => {
    chatApi
      .listSessions()
      .then((r) => setRecentChats(r.sessions.slice(0, RECENT_CHATS_LIMIT)))
      .catch(() => setRecentChats([]));
  };

  useEffect(() => {
    refreshProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg]);

  // Re-check recent chats on every navigation — cheap, and it's how a session
  // created or auto-titled elsewhere (ChatPanel) shows up here without a
  // dedicated cross-component event bus.
  useEffect(() => {
    refreshRecentChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg, location.pathname, location.search, chatListVersion]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const currentOrg = orgs.find((o) => o.orgId === activeOrg?.orgId);
  const initials = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  const chatPath = (s: ChatSessionSummary) =>
    s.scope === 'personal' ? '/personal/chat' : `/projects/${s.projectId}/chat`;

  return (
    <div className="flex h-screen bg-white">
      <aside className="flex w-64 flex-col overflow-y-auto border-r border-neutral-150 bg-surface-gradient px-4 py-5">
        <Link to="/" className="transition-opacity hover:opacity-80">
          <Logo />
        </Link>

        <OrgSwitcher />

        <nav className="mt-8 flex flex-col gap-0.5">
          <SidebarLink to="/chats" label="Chats" icon={<ChatBubbleIcon />} active={location.pathname === '/chats'} />
          {recentChats.length > 0 && (
            <ul className="ml-[26px] flex flex-col gap-0.5 border-l border-neutral-150 pl-2.5">
              {recentChats.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`${chatPath(s)}?session=${s.id}`}
                    className={`block truncate rounded-md px-2 py-1 text-xs transition-colors ${
                      location.search === `?session=${s.id}`
                        ? 'font-medium text-magenta-600'
                        : 'text-neutral-500 hover:text-ink'
                    }`}
                  >
                    {s.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <SidebarLink
            to="/personal/chat"
            label="Personal"
            icon={<UserIcon />}
            active={location.pathname.startsWith('/personal')}
          />
        </nav>

        <hr className="my-4 border-neutral-150" />

        <nav className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between px-3">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Projects</span>
            <NewProjectButton onCreated={refreshProjects} />
          </div>

          {projects.length === 0 && <p className="px-3 py-1 text-xs text-neutral-400">No projects yet.</p>}
          {projects.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3), ease: [0.16, 1, 0.3, 1] }}
            >
              <SidebarLink
                to={`/projects/${p.id}/chat`}
                label={p.name}
                icon={<FolderIcon />}
                active={location.pathname.startsWith(`/projects/${p.id}`)}
              />
            </motion.div>
          ))}
        </nav>

        <hr className="my-4 border-neutral-150" />

        <nav className="flex flex-col gap-0.5">
          <SidebarLink to="/members" label="Members" icon={<UsersIcon />} active={location.pathname === '/members'} />
        </nav>

        <Link
          to="/profile"
          className="mt-auto flex items-center gap-2.5 border-t border-neutral-150 pt-4 transition-opacity hover:opacity-80"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-magenta-gradient text-xs font-semibold text-white shadow-sm">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{user?.name || user?.email}</p>
            <p className="truncate text-xs capitalize text-neutral-500">{currentOrg?.role}</p>
          </div>
          <button
            onClick={(e) => {
              e.preventDefault();
              handleLogout();
            }}
            aria-label="Log out"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-magenta-500"
          >
            <LogoutIcon className="h-4 w-4" />
          </button>
        </Link>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}

function SidebarLink({
  to,
  label,
  icon,
  active,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Link to={to} className="relative block">
      {active && (
        <motion.span
          layoutId="sidebar-active-pill"
          className="absolute inset-0 rounded-lg bg-magenta-50"
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}
      <span
        className={`relative flex items-center gap-2.5 truncate rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
          active ? 'text-magenta-600' : 'text-neutral-600 hover:bg-neutral-100 hover:text-ink'
        }`}
      >
        <span className={`shrink-0 [&>svg]:h-4 [&>svg]:w-4 ${active ? 'text-magenta-500' : 'text-neutral-400'}`}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
    </Link>
  );
}
