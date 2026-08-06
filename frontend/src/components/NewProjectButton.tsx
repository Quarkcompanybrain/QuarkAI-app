import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { projectsApi } from '../features/projects/api';
import { useClickOutside } from '../hooks/useClickOutside';
import { PlusIcon } from './icons';

export function NewProjectButton({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setOpen(false), open);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const res = await projectsApi.create(trimmed);
    setName('');
    setOpen(false);
    onCreated();
    navigate(`/projects/${res.project.id}/chat`);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-5 w-5 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-magenta-500"
        aria-label="New project"
      >
        <PlusIcon className="h-3.5 w-3.5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full z-20 mt-1.5 w-56 rounded-xl border border-neutral-150 bg-white p-2 shadow-lg"
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Project name"
              className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-magenta-500"
            />
            <div className="mt-1.5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
