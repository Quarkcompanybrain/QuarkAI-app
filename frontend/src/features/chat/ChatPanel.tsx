import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { chatApi, streamChatMessage } from './api';
import type { ChatMessage, ChatScope } from '../../types';
import { PulseNode } from '../../components/PulseNode';
import { ErrorBanner } from '../../components/ErrorBanner';
import { EmptyState } from '../../components/EmptyState';
import { BrainIcon, PlusIcon, SendIcon } from '../../components/icons';
import { useChatListStore } from '../../store/chatListStore';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function ChatPanel({
  scope,
  projectId,
  initialSessionId,
  onSessionChange,
}: {
  scope: ChatScope;
  projectId?: string;
  initialSessionId?: string;
  /** Fired whenever the active session changes (new chat, or one lazily created on first send) so the parent can keep the URL in sync. */
  onSessionChange?: (sessionId: string) => void;
}) {
  const bumpChatList = useChatListStore((s) => s.bump);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Tracks the last session id *this component* set (via ensureSession/handleNewChat),
  // so we can tell "initialSessionId changed because our own onSessionChange updated
  // the URL" apart from "the user actually navigated to a different chat" — otherwise
  // the load-effect below resets state mid-stream and drops the in-flight reply.
  const ownedSessionId = useRef<string | null>(null);

  const setActiveSession = (id: string) => {
    ownedSessionId.current = id;
    setSessionId(id);
    onSessionChange?.(id);
  };

  const loadSession = (id: string) => {
    ownedSessionId.current = id;
    setSessionId(id);
    chatApi
      .listMessages(id)
      .then((m) =>
        setMessages(m.messages.map((msg: ChatMessage) => ({ id: msg.id, role: msg.role, content: msg.content })))
      )
      .catch(() => setError('Could not load that chat.'));
  };

  useEffect(() => {
    if (initialSessionId && initialSessionId === ownedSessionId.current) return;

    setError(null);
    setSessionId(null);
    setMessages([]);

    if (initialSessionId) {
      loadSession(initialSessionId);
      return;
    }

    // No specific session requested — fall back to the most recent one for this scope.
    chatApi
      .listSessions(scope, projectId)
      .then((r) => {
        const existing = r.sessions[0];
        if (existing) loadSession(existing.id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, projectId, initialSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const res = await chatApi.createSession(scope, projectId);
    setActiveSession(res.session.id);
    return res.session.id;
  };

  // Resets to a blank composer only — no session doc is created until the
  // user actually sends a message (ensureSession handles that lazily).
  const handleNewChat = () => {
    setError(null);
    setMessages([]);
    setInput('');
    ownedSessionId.current = null;
    setSessionId(null);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: text }]);

    const sid = await ensureSession();
    setStreaming(true);

    const assistantId = `local-assistant-${Date.now()}`;
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

    await streamChatMessage(sid, text, {
      onToken: (delta) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
        );
      },
      onDone: () => {
        setStreaming(false);
        bumpChatList();
      },
      onError: (message) => {
        setError(message);
        setStreaming(false);
      },
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end pb-3">
        <button
          onClick={handleNewChat}
          disabled={streaming}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-magenta-600 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New chat
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {messages.length === 0 ? (
          <EmptyState
            icon={<BrainIcon className="h-5 w-5 text-magenta-500" />}
            title="Nothing asked yet"
            description={`Ask anything about ${scope === 'personal' ? 'your personal files' : 'this project’s files'} — Quark AI answers from what’s stored in memory.`}
          />
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.role === 'assistant' && (
                  <div className="mr-2 mt-1 h-5 w-5 shrink-0 rounded-full bg-magenta-gradient shadow-glow-sm" />
                )}
                <div
                  className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-ink text-white shadow-sm'
                      : 'border border-neutral-150 bg-white text-ink shadow-xs'
                  }`}
                >
                  {m.content || (streaming && <PulseNode size={6} />)}
                  {m.role === 'assistant' && streaming && m.content && (
                    <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-blink bg-magenta-500" />
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        <div ref={bottomRef} />
      </div>

      <ErrorBanner message={error} />

      <div className="mt-3 flex items-end gap-2 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-sm transition-shadow duration-200 focus-within:border-magenta-500 focus-within:shadow-[0_0_0_3px_rgba(255,27,205,0.10)]">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder="Ask Quark AI…"
          className="flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-ink outline-none placeholder:text-neutral-400"
        />
        <motion.button
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.12 }}
          aria-label="Send message"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-magenta-gradient text-white shadow-glow-sm transition-opacity disabled:opacity-30 disabled:shadow-none"
        >
          {streaming ? <PulseNode size={8} active /> : <SendIcon className="h-3.5 w-3.5" />}
        </motion.button>
      </div>
    </div>
  );
}
