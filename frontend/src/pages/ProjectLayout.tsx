import { useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { TabNav } from '../components/TabNav';
import { projectsApi } from '../features/projects/api';
import type { Project } from '../types';

export function ProjectLayout() {
  const { projectId = '' } = useParams();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    setProject(null);
    projectsApi.get(projectId).then((r) => setProject(r.project));
  }, [projectId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-6 pt-6">
        <h1 className="mb-4 font-display text-2xl font-semibold text-ink">{project?.name || 'Project'}</h1>
      </div>
      <TabNav
        tabs={[
          { to: `/projects/${projectId}/chat`, label: 'Chat' },
          { to: `/projects/${projectId}/files`, label: 'Files' },
          { to: `/projects/${projectId}/settings`, label: 'Settings' },
        ]}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet
          context={{ project, refreshProject: () => projectsApi.get(projectId).then((r) => setProject(r.project)) }}
        />
      </div>
    </div>
  );
}
