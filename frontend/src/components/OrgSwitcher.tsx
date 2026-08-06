import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../features/auth/api';
import { orgApi } from '../features/org/api';
import { useClickOutside } from '../hooks/useClickOutside';
import { ChevronDownIcon, PlusIcon } from './icons';
import { ApiRequestError } from '../lib/api';

export function OrgSwitcher() {
  const navigate = useNavigate();
  const { orgs, activeOrg, setSession, setOrgs, setActiveOrg } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(
    containerRef,
    () => {
      setOpen(false);
      setCreating(false);
    },
    open
  );

  const currentOrg = orgs.find((o) => o.orgId === activeOrg?.orgId);

  const handleSwitch = async (orgId: string) => {
    if (orgId === activeOrg?.orgId) {
      setOpen(false);
      return;
    }
    const res = await authApi.switchOrg(orgId);
    setSession({ token: res.token });
    if (res.activeOrg) setActiveOrg(res.activeOrg);
    setOpen(false);
    navigate('/');
    window.location.reload();
  };

  const handleCreate = async () => {
    const name = newOrgName.trim();
    if (!name) return;
    setError(null);
    try {
      const res = await orgApi.create(name);
      setSession({ token: res.token, activeOrg: res.activeOrg });
      setOrgs([...orgs, { orgId: res.org.id, name: res.org.name, role: 'admin' }]);
      setActiveOrg(res.activeOrg);
      setNewOrgName('');
      setCreating(false);
      setOpen(false);
      navigate('/');
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create organization.');
    }
  };

  if (orgs.length === 0) return null;

  return (
    <div ref={containerRef} className="relative mt-6">
      <label className="text-xs font-medium uppercase tracking-wide text-neutral-400">Organization</label>
      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-1.5 flex w-full items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm text-ink shadow-xs transition-colors hover:border-neutral-300"
      >
        <span className="truncate">{currentOrg?.name}</span>
        <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-neutral-150 bg-white shadow-lg"
          >
            <ul className="max-h-48 overflow-y-auto p-1">
              {orgs.map((o) => (
                <li key={o.orgId}>
                  <button
                    onClick={() => handleSwitch(o.orgId)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                      o.orgId === activeOrg?.orgId ? 'bg-magenta-50 text-magenta-600' : 'text-ink hover:bg-neutral-100'
                    }`}
                  >
                    <span className="truncate">{o.name}</span>
                    <span className="ml-2 shrink-0 text-xs capitalize text-neutral-400">{o.role}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="border-t border-neutral-150 p-1">
              {creating ? (
                <div className="p-1.5">
                  <input
                    autoFocus
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    placeholder="Organization name"
                    className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-xs text-ink outline-none focus:border-magenta-500"
                  />
                  {error && <p className="mt-1.5 text-xs text-magenta-500">{error}</p>}
                  <div className="mt-1.5 flex justify-end gap-2">
                    <button
                      onClick={() => setCreating(false)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-700"
                    >
                      Create
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-magenta-600 transition-colors hover:bg-magenta-50"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Create organization
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
