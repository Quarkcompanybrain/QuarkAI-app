import { useNavigate } from 'react-router-dom';
import { PlusIcon } from './icons';

export function NewProjectButton() {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate('/projects/new')}
      className="flex h-5 w-5 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-magenta-500"
      aria-label="Create project"
    >
      <PlusIcon className="h-3.5 w-3.5" />
    </button>
  );
}
