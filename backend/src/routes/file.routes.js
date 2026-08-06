const { Router } = require('express');
const ctrl = require('../controllers/file.controller');
const { requireAuth } = require('../middleware/auth');
const { requireOrgContext } = require('../middleware/activeOrg');
const { optionalProjectScope } = require('../middleware/scoping');
const { upload } = require('../middleware/upload');

const router = Router();

router.use(requireAuth, requireOrgContext);

router.post('/', optionalProjectScope, upload.single('file'), ctrl.uploadFile);
router.get('/', optionalProjectScope, ctrl.listFiles);
router.get('/:fileId', ctrl.getFile);
router.get('/:fileId/chunks', ctrl.getFileChunks);

module.exports = router;
