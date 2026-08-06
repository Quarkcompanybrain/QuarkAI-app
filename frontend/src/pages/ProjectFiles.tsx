import { useParams } from 'react-router-dom';
import { FilesPanel } from '../features/files/FilesPanel';

export function ProjectFiles() {
  const { projectId = '' } = useParams();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
      <FilesPanel projectId={projectId} />
    </div>
  );
}
