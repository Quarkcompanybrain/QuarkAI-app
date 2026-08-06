import { Outlet } from 'react-router-dom';
import { TabNav } from '../components/TabNav';
import { useAuthStore } from '../store/authStore';

export function PersonalLayout() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-6 pt-6">
        <h1 className="font-display text-2xl font-semibold text-ink">Personal space</h1>
        <p className="mb-4 text-sm text-neutral-500">Only you can see files and chats here, {user?.name}.</p>
      </div>
      <TabNav
        tabs={[
          { to: '/personal/chat', label: 'Chat' },
          { to: '/personal/files', label: 'Files' },
        ]}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
