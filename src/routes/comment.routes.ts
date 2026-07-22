import express from "express";
import {
	create,
	getComments,
	handleCommentAction,
	patchComment,
	removeComment,
} from "../controllers/comment.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { requireModerator } from "../middlewares/role.middleware.js";

const router = express.Router();

router.get("/post/:postId", requireAuth, getComments);
router.post("/", requireAuth, create);

router.patch("/:id", requireAuth, patchComment);
router.delete("/:id", requireAuth, removeComment);

router.post("/:id/save", requireAuth, handleCommentAction("SAVE"));
router.post(
	"/:id/lock",
	requireAuth,
	requireModerator,
	handleCommentAction("LOCK"),
);
router.post(
	"/:id/remove",
	requireAuth,
	requireModerator,
	handleCommentAction("REMOVE"),
);
router.post("/:id/report", requireAuth, handleCommentAction("REPORT"));

export default router;
