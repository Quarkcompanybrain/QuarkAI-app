const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');
const { otpRequestLimiter, otpVerifyLimiter } = require('../middleware/rateLimit');
const { upload } = require('../middleware/upload');

const router = Router();

router.post('/signup/request-otp', otpRequestLimiter, ctrl.requestSignupOtp);
router.post('/signup/verify', otpVerifyLimiter, ctrl.verifySignupOtp);
router.post('/login', ctrl.login);
router.get('/me', requireAuth, ctrl.me);
router.patch('/me', requireAuth, ctrl.updateProfile);
router.post('/me/avatar', requireAuth, upload.single('avatar'), ctrl.uploadAvatar);
router.post('/switch-org', requireAuth, ctrl.switchOrg);

router.post('/forgot-password/request-otp', otpRequestLimiter, ctrl.requestPasswordReset);
router.post('/forgot-password/reset', otpVerifyLimiter, ctrl.resetPassword);

module.exports = router;
