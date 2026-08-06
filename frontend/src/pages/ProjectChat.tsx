import { useParams, useSearchParams } from 'react-router-dom';
import { ChatPanel } from '../features/chat/ChatPanel';

export function ProjectChat() {
  const { projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionId = searchParams.get('session') || undefined;

  return (
    <div className="min-h-0 flex-1 px-6 pb-6 pt-6">
      <ChatPanel
        scope="project"
        projectId={projectId}
        initialSessionId={sessionId}
        onSessionChange={(id) => setSearchParams({ session: id }, { replace: true })}
      />
    </div>
  );
}
