const { Router } = require('express');
const ctrl = require('../controllers/integration.controller');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// Integrations are personal (tied to the user, not an org), so no
// requireOrgContext here — only requireAuth.
router.use(requireAuth);

router.get('/', ctrl.listIntegrations);
router.get('/google', ctrl.getGoogleWorkspace);
router.post('/whatsapp/connect', ctrl.connectWhatsapp);
router.post('/email/connect', ctrl.connectEmail);
router.post('/cheerio/connect', ctrl.connectCheerio);
router.get('/:id/stream', ctrl.streamStatus);
router.get('/:id/chats', ctrl.listChats);
router.delete('/:id', ctrl.disconnectIntegration);

module.exports = router;
