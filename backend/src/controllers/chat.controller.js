const Sentry = require('@sentry/node');
const ChatSession = require('../models/ChatSession');
const Message = require('../models/Message');
const { embedText } = require('../services/embeddings/openai.service');
const { searchChunks } = require('../services/vectorstore/atlas.service');
const { streamAnswer, generateChatTitle } = require('../services/agent/claude.service');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

const createSession = asyncHandler(async (req, res) => {
  const { scope, projectId, title } = req.body;
  if (!['personal', 'project'].includes(scope)) throw new ApiError(400, 'scope must be personal or project.');
  if (scope === 'project' && !projectId) throw new ApiError(400, 'projectId is required for project scope.');

  const session = await ChatSession.create({
    userId: req.user.id,
    orgId: req.org.id,
    scope,
    projectId: scope === 'project' ? projectId : null,
    title: title || 'New chat',
  });

  Sentry.logger.info('Chat session created', { sessionId: String(session._id), scope, projectId: projectId || null });

  res.status(201).json({ session: { id: session._id, scope: session.scope, projectId: session.projectId, title: session.title } });
});

const listSessions = asyncHandler(async (req, res) => {
  const { scope, projectId } = req.query;
  const filter = { userId: req.user.id, orgId: req.org.id };
  if (scope) filter.scope = scope;
  if (projectId) filter.projectId = projectId;

  const sessions = await ChatSession.find(filter).sort({ updatedAt: -1 }).populate('projectId', 'name');
  res.json({
    sessions: sessions.map((s) => ({
      id: s._id,
      scope: s.scope,
      projectId: s.projectId?._id || null,
      projectName: s.projectId?.name || null,
      title: s.title,
      updatedAt: s.updatedAt,
    })),
  });
});

const listMessages = asyncHandler(async (req, res) => {
  const session = await ChatSession.findOne({ _id: req.params.sessionId, userId: req.user.id, orgId: req.org.id });
  if (!session) throw new ApiError(404, 'Chat session not found.');

  const messages = await Message.find({ sessionId: session._id }).sort({ createdAt: 1 });
  res.json({ messages: messages.map((m) => ({ id: m._id, role: m.role, content: m.content, createdAt: m.createdAt })) });
});

const updateSession = asyncHandler(async (req, res) => {
  const { title } = req.body;
  if (!title || !title.trim()) throw new ApiError(400, 'title is required.');

  const session = await ChatSession.findOneAndUpdate(
    { _id: req.params.sessionId, userId: req.user.id, orgId: req.org.id },
    { title: title.trim().slice(0, 80) },
    { new: true }
  );
  if (!session) throw new ApiError(404, 'Chat session not found.');

  Sentry.logger.info('Chat session renamed', { sessionId: String(session._id) });
  res.json({ session: { id: session._id, title: session.title } });
});

/**
 * SSE endpoint: retrieves scoped context via vector search, streams Claude's
 * answer token-by-token as plain `data:` events, then persists both messages.
 */
const sendMessage = asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message) throw new ApiError(400, 'message is required.');

  const session = await ChatSession.findOne({ _id: req.params.sessionId, userId: req.user.id, orgId: req.org.id });
  if (!session) throw new ApiError(404, 'Chat session not found.');

  const isFirstMessage = (await Message.countDocuments({ sessionId: session._id })) === 0;

  await Message.create({ sessionId: session._id, role: 'user', content: message });

  const queryEmbedding = await embedText(message);
  const retrievedChunks = await searchChunks({
    queryEmbedding,
    orgId: req.org.id,
    scope: session.scope,
    projectId: session.projectId,
    ownerId: req.user.id,
    topK: 8,
  });

  Sentry.logger.info('Chat message received', {
    sessionId: String(session._id),
    retrievedChunkCount: retrievedChunks.length,
  });

  const priorMessages = await Message.find({ sessionId: session._id }).sort({ createdAt: 1 });
  const history = priorMessages.map((m) => ({ role: m.role, content: m.content }));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendEvent = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const fullText = await streamAnswer({
      history,
      retrievedChunks,
      onToken: (delta) => sendEvent('token', { delta }),
    });

    const citedChunkIds = retrievedChunks.map((c) => c._id);
    await Message.create({ sessionId: session._id, role: 'assistant', content: fullText, citedChunkIds });

    Sentry.logger.info('Chat reply streamed', { sessionId: String(session._id), replyLength: fullText.length });

    let title = null;
    if (isFirstMessage) {
      try {
        title = await generateChatTitle(message);
        if (title) {
          await ChatSession.findByIdAndUpdate(session._id, { title });
          Sentry.logger.info('Chat session auto-titled', { sessionId: String(session._id), title });
        }
      } catch (titleErr) {
        // Non-critical — the session just keeps its default title.
        Sentry.captureException(titleErr, { tags: { pipeline: 'chat_title' } });
      }
    }

    sendEvent('done', {
      title,
      sources: retrievedChunks.map((c) => ({ id: c._id, filename: c.metadata?.filename, score: c.score })),
    });
  } catch (err) {
    sendEvent('error', { message: err.message });
    Sentry.captureException(err, {
      tags: { pipeline: 'chat_stream' },
      extra: { sessionId: String(session._id), scope: session.scope },
    });
  } finally {
    res.end();
  }
});

module.exports = { createSession, listSessions, listMessages, updateSession, sendMessage };
