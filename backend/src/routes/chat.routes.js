const { Router } = require('express');
const ctrl = require('../controllers/chat.controller');
const { requireAuth } = require('../middleware/auth');
const { requireOrgContext } = require('../middleware/activeOrg');
const { optionalProjectScope } = require('../middleware/scoping');

const router = Router();

router.use(requireAuth, requireOrgContext);

router.post('/sessions', optionalProjectScope, ctrl.createSession);
router.get('/sessions', ctrl.listSessions);
router.patch('/sessions/:sessionId', ctrl.updateSession);
router.get('/sessions/:sessionId/messages', ctrl.listMessages);
router.post('/sessions/:sessionId/messages', ctrl.sendMessage);

module.exports = router;
