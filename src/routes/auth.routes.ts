import express from "express";
import {
	deleteUser,
	forgotPassword,
	getUserDetails,
	login,
	logout,
	refresh,
	register,
	resendToken,
	resetPassword,
	updateUserDetails,
	updateUserPassword,
	verifyEmail,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/resend-verification", resendToken);
router.post("/verify-email", verifyEmail);

router.get("/me", requireAuth, getUserDetails);
router.patch("/me", requireAuth, updateUserDetails);
router.delete("/me", requireAuth, deleteUser);
router.post("/change-password", requireAuth, updateUserPassword);

export default router;
