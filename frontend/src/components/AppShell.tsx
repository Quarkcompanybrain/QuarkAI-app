import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Logo } from './Logo';
import { OrgSwitcher } from './OrgSwitcher';
import { NewProjectButton } from './NewProjectButton';
import { useAuthStore } from '../store/authStore';
import { useChatListStore } from '../store/chatListStore';
import { projectsApi } from '../features/projects/api';
import { chatApi } from '../features/chat/api';
import { ChatBubbleIcon, FolderIcon, LogoutIcon, MenuIcon, PlugIcon, UserIcon, UsersIcon, XIcon } from './icons';
import type { ChatSessionSummary, Project } from '../types';

const RECENT_CHATS_LIMIT = 5;

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, orgs, activeOrg, logout } = useAuthStore();
  const chatListVersion = useChatListStore((s) => s.version);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentChats, setRecentChats] = useState<ChatSessionSummary[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);

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
  }, [activeOrg, location.pathname]);

  // Re-check recent chats on every navigation — cheap, and it's how a session
  // created or auto-titled elsewhere (ChatPanel) shows up here without a
  // dedicated cross-component event bus.
  useEffect(() => {
    refreshRecentChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg, location.pathname, location.search, chatListVersion]);

  // Close the mobile drawer on every navigation so it doesn't stay open
  // after picking a link.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const sidebarProps = {
    user,
    orgs,
    activeOrg,
    projects,
    recentChats,
    location,
    onLogout: handleLogout,
    onCreatedProject: refreshProjects,
  };

  return (
    <div className="flex h-screen flex-col bg-white md:flex-row">
      {/* Mobile top bar */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-150 bg-white px-4 md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <Logo />
        <div className="w-9" />
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-y-auto bg-surface-gradient px-4 py-5 shadow-lg md:hidden"
            >
              <div className="mb-2 flex items-center justify-between">
                <Logo />
                <button
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close menu"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
              <SidebarBody {...sidebarProps} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop persistent sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-neutral-150 bg-surface-gradient px-4 py-5 md:flex">
        <Link to="/" className="mb-0 transition-opacity hover:opacity-80">
          <Logo />
        </Link>
        <SidebarBody {...sidebarProps} />
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}

interface SidebarBodyProps {
  user: ReturnType<typeof useAuthStore.getState>['user'];
  orgs: ReturnType<typeof useAuthStore.getState>['orgs'];
  activeOrg: ReturnType<typeof useAuthStore.getState>['activeOrg'];
  projects: Project[];
  recentChats: ChatSessionSummary[];
  location: ReturnType<typeof useLocation>;
  onLogout: () => void;
  onCreatedProject: () => void;
}

function SidebarBody({
  user,
  orgs,
  activeOrg,
  projects,
  recentChats,
  location,
  onLogout,
  onCreatedProject,
}: SidebarBodyProps) {
  const currentOrg = orgs.find((o) => o.orgId === activeOrg?.orgId);
  const initials = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  const chatPath = (s: ChatSessionSummary) =>
    s.scope === 'personal' ? '/personal/chat' : `/projects/${s.projectId}/chat`;

  return (
    <>
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
          <NewProjectButton onCreated={onCreatedProject} />
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
        <SidebarLink
          to="/integrations"
          label="Integrations"
          icon={<PlugIcon />}
          active={location.pathname === '/integrations'}
        />
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
            onLogout();
          }}
          aria-label="Log out"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-magenta-500"
        >
          <LogoutIcon className="h-4 w-4" />
        </button>
      </Link>
    </>
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
