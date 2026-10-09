import { type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { ForgotPassword } from './pages/ForgotPassword';
import { AcceptInvite } from './pages/AcceptInvite';
import { ChatsHistory } from './pages/ChatsHistory';
import { Profile } from './pages/Profile';
import { Integrations } from './pages/Integrations';
import { PersonalLayout } from './pages/PersonalLayout';
import { PersonalChat } from './pages/PersonalChat';
import { PersonalFiles } from './pages/PersonalFiles';
import { ProjectLayout } from './pages/ProjectLayout';
import { ProjectChat } from './pages/ProjectChat';
import { ProjectMemory } from './pages/ProjectMemory';
import { ProjectSettings } from './pages/ProjectSettings';
import { ProjectCreate } from './pages/ProjectCreate';
import { Members } from './pages/Members';
import { useAuthStore } from './store/authStore';
import { SessionBoot } from './components/SessionBoot';
import { AppShell } from './components/AppShell';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// The backend enforces this too; this only keeps members off a form they can't submit.
function OrgAdminRoute({ children }: { children: ReactNode }) {
  const role = useAuthStore((s) => s.activeOrg?.role);
  if (role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />

        <Route
          element={
            <ProtectedRoute>
              <SessionBoot>
                {/* AppShell mounts once for the whole protected section — nested
                    routes only swap what's inside it, so the sidebar (and its
                    projects fetch) never remounts on navigation. */}
                <AppShell>
                  <Outlet />
                </AppShell>
              </SessionBoot>
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Navigate to="/personal/chat" replace />} />

          <Route path="/chats" element={<ChatsHistory />} />

          <Route path="/personal" element={<PersonalLayout />}>
            <Route index element={<Navigate to="chat" replace />} />
            <Route path="chat" element={<PersonalChat />} />
            <Route path="files" element={<PersonalFiles />} />
          </Route>

          <Route path="/projects/new" element={<OrgAdminRoute><ProjectCreate /></OrgAdminRoute>} />

          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<Navigate to="chat" replace />} />
            <Route path="chat" element={<ProjectChat />} />
            <Route path="memory" element={<ProjectMemory />} />
            <Route path="settings" element={<ProjectSettings />} />
          </Route>

          <Route path="/members" element={<Members />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/integrations" element={<Integrations />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
