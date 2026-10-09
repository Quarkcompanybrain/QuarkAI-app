const { Router } = require('express');
const ctrl = require('../controllers/project.controller');
const sourceCtrl = require('../controllers/projectSource.controller');
const chunkCtrl = require('../controllers/chunk.controller');
const { requireAuth } = require('../middleware/auth');
const { requireOrgContext, requireOrgAdmin } = require('../middleware/activeOrg');
const { requireProjectMember, requireProjectAdmin } = require('../middleware/scoping');

const router = Router();

router.use(requireAuth, requireOrgContext);

// Only org admins create projects, so admins are members of every project
// they create and the daily brief never leaks a project to an outsider.
router.post('/', requireOrgAdmin, ctrl.createProject);
router.get('/', ctrl.listMyProjects);
router.get('/:projectId', requireProjectMember, ctrl.getProject);
router.patch('/:projectId', requireProjectMember, ctrl.updateProject);
router.delete('/:projectId', requireProjectMember, ctrl.deleteProject);
router.get('/:projectId/members', requireProjectMember, ctrl.listProjectMembers);
router.post('/:projectId/members', requireProjectMember, ctrl.addProjectMember);
router.delete('/:projectId/members/:userId', requireProjectMember, ctrl.removeProjectMember);

router.patch('/:projectId/chunks/:chunkId', requireProjectMember, requireProjectAdmin, chunkCtrl.updateProjectChunk);
router.delete('/:projectId/chunks/:chunkId', requireProjectMember, requireProjectAdmin, chunkCtrl.deleteProjectChunk);

router.get('/:projectId/sources', requireProjectMember, sourceCtrl.listSources);
router.post('/:projectId/sources', requireProjectMember, sourceCtrl.addSource);
router.delete('/:projectId/sources/:sourceId', requireProjectMember, sourceCtrl.removeSource);
router.get('/:projectId/whatsapp-memory', requireProjectMember, sourceCtrl.listWhatsAppMemory);

module.exports = router;
