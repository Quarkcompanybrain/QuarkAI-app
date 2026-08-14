const { Router } = require('express');
const ctrl = require('../controllers/project.controller');
const sourceCtrl = require('../controllers/projectSource.controller');
const { requireAuth } = require('../middleware/auth');
const { requireOrgContext } = require('../middleware/activeOrg');
const { requireProjectMember } = require('../middleware/scoping');

const router = Router();

router.use(requireAuth, requireOrgContext);

router.post('/', ctrl.createProject);
router.get('/', ctrl.listMyProjects);
router.get('/:projectId', requireProjectMember, ctrl.getProject);
router.patch('/:projectId', requireProjectMember, ctrl.updateProject);
router.get('/:projectId/members', requireProjectMember, ctrl.listProjectMembers);
router.post('/:projectId/members', requireProjectMember, ctrl.addProjectMember);
router.delete('/:projectId/members/:userId', requireProjectMember, ctrl.removeProjectMember);

router.get('/:projectId/sources', requireProjectMember, sourceCtrl.listSources);
router.post('/:projectId/sources', requireProjectMember, sourceCtrl.addSource);
router.delete('/:projectId/sources/:sourceId', requireProjectMember, sourceCtrl.removeSource);
router.get('/:projectId/whatsapp-memory', requireProjectMember, sourceCtrl.listWhatsAppMemory);

module.exports = router;
