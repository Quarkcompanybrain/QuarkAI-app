const { Router } = require('express');

const router = Router();

router.use('/auth', require('./auth.routes'));
router.use('/orgs', require('./org.routes'));
router.use('/projects', require('./project.routes'));
router.use('/files', require('./file.routes'));
router.use('/chat', require('./chat.routes'));
router.use('/integrations', require('./integration.routes'));

module.exports = router;
