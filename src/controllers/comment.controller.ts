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
	commentListQuerySchema,
	commentPostIdParamSchema,
	commentReasonBodySchema,
	createCommentSchema,
	emptyCommentActionBodySchema,
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
	const { postId } = commentPostIdParamSchema.parse(req.params);
	const query = commentListQuerySchema.parse(req.query);
	const result = await getPostComments(postId, {
		limit: query.limit,
		...(query.cursor ? { cursor: query.cursor } : {}),
	});
	res.status(200).json({
		success: true,
		data: result.comments,
		meta: { nextCursor: result.nextCursor },
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

/**
 * Builds a handler for one moderation action so the four routes share a single
 * implementation instead of duplicating parse-and-dispatch logic.
 */
export const handleCommentAction = (
	actionType: "LOCK" | "REMOVE" | "SAVE" | "REPORT",
) => {
	return asyncHandler(async (req: Request, res: Response) => {
		const { id } = commentIdParamSchema.parse(req.params);
		const userId = res.locals.user.userId;
		let reasonText: string | undefined;
		if (actionType === "REPORT" || actionType === "REMOVE") {
			reasonText = commentReasonBodySchema.parse(req.body ?? {}).reason;
		} else {
			emptyCommentActionBodySchema.parse(req.body ?? {});
		}

		await modifyCommentState(id, userId, actionType, reasonText);
		res.status(200).json({
			success: true,
			message: `Comment operation ${actionType} executed successfully.`,
		});
	});
};
