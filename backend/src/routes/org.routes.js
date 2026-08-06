const { Router } = require('express');
const ctrl = require('../controllers/org.controller');
const { requireAuth } = require('../middleware/auth');
const { requireOrgContext, requireOrgAdmin } = require('../middleware/activeOrg');
const { inviteLimiter } = require('../middleware/rateLimit');

const router = Router();

router.post('/', requireAuth, ctrl.createOrg);
router.get('/members', requireAuth, requireOrgContext, ctrl.listMembers);
router.post('/invites', requireAuth, requireOrgContext, requireOrgAdmin, inviteLimiter, ctrl.inviteMember);
router.get('/invites', requireAuth, requireOrgContext, requireOrgAdmin, ctrl.listPendingInvites);

// Public — invite accept flow (no org context yet, that's what's being granted)
router.get('/invites/:token', ctrl.getInvite);
router.post('/invites/:token/accept', ctrl.acceptInvite);

module.exports = router;
