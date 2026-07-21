import type { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
	createComment,
	getPostComments,
	modifyCommentState,
	softDeleteComment,
	updateCommentFields,
} from "../services/comment.service.js";
import {
	commentIdParamSchema,
	createCommentSchema,
	updateCommentSchema,
} from "../validators/comment.validator.js";

export const create = asyncHandler(async (req: Request, res: Response) => {
	const authorId = res.locals.user.userId;
	const validatedData = createCommentSchema.parse(req.body);
	const newComment = await createComment(validatedData, authorId);
	res.status(201).json({
		success: true,
		data: newComment,
	});
});

export const getComments = asyncHandler(async (req: Request, res: Response) => {
	const postId = req.params.postId as string;
	const postComment = await getPostComments(postId);
	res.status(200).json({
		success: true,
		data: postComment,
	});
});

export const patchComment = asyncHandler(
	async (req: Request, res: Response) => {
		const { id } = commentIdParamSchema.parse(req.params);
		const { content } = updateCommentSchema.parse(req.body);
		const updatedComment = await updateCommentFields(
			id,
			res.locals.user.userId,
			content,
		);
		res.status(200).json({ success: true, data: updatedComment });
	},
);

export const removeComment = asyncHandler(
	async (req: Request, res: Response) => {
		const { id } = commentIdParamSchema.parse(req.params);
		await softDeleteComment(id, res.locals.user.userId);
		res.status(204).end();
	},
);

export const handleCommentAction = (
	actionType: "LOCK" | "REMOVE" | "SAVE" | "REPORT",
) => {
	return asyncHandler(async (req: Request, res: Response) => {
		const { id } = commentIdParamSchema.parse(req.params);
		const userId = res.locals.user.userId;
		const reasonText = req.body?.reason ? String(req.body.reason) : undefined;

		await modifyCommentState(id, userId, actionType, reasonText);
		res.status(200).json({
			success: true,
			message: `Comment operation ${actionType} executed successfully.`,
		});
	});
};
