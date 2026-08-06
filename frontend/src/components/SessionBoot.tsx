import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../features/auth/api';
import { orgApi } from '../features/org/api';
import { Card } from './Card';
import { Input } from './Input';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import { Logo } from './Logo';
import { ApiRequestError } from '../lib/api';

/**
 * Loads the current user + their org memberships once per session, and gates
 * every protected route behind having at least one org (prompting to create
 * one otherwise). Wraps all routes under ProtectedRoute so this only runs once.
 */
export function SessionBoot({ children }: { children: ReactNode }) {
  const { orgs, activeOrg, setSession, setOrgs, setActiveOrg } = useAuthStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi
      .me()
      .then((res) => {
        setSession({ token: localStorage.getItem('quark_token') || '', user: res.user });
        setOrgs(res.orgs);
        if (!activeOrg && res.orgs[0]) setActiveOrg({ orgId: res.orgs[0].orgId, role: res.orgs[0].role });
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return null;
  if (orgs.length === 0) return <CreateOrgPrompt />;

  return <>{children}</>;
}

function CreateOrgPrompt() {
  const { setSession, setOrgs, setActiveOrg } = useAuthStore();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await orgApi.create(name);
      setSession({ token: res.token, activeOrg: res.activeOrg });
      setOrgs([{ orgId: res.org.id, name: res.org.name, role: 'admin' }]);
      setActiveOrg(res.activeOrg);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <h1 className="mb-1 text-center font-display text-xl font-semibold text-ink">Create your organization</h1>
        <p className="mb-6 text-center text-sm text-neutral-500">
          This is where your team's projects and shared knowledge will live.
        </p>
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <Input label="Organization name" value={name} onChange={(e) => setName(e.target.value)} required />
          <ErrorBanner message={error} />
          <Button type="submit" loading={loading} className="w-full">
            Create organization
          </Button>
        </form>
      </Card>
    </div>
  );
}
