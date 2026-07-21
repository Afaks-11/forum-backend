import type { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
	createPost,
	getAdvancedPostsFeed,
	getPostById,
	getPostVoteMetrics,
	modifyPostModerationState,
	savePostAction,
	searchForPosts,
	softDeletePost,
	updatePostFields,
} from "../services/post.service.js";
import {
	createPostSchema,
	postFeedQuerySchema,
	postIdParamSchema,
	postSearchSchema,
	postVoteParamSchema,
	updatePostSchema,
} from "../validators/post.validator.js";

export const create = asyncHandler(async (req: Request, res: Response) => {
	const authorId = res.locals.user.userId;
	const validateData = createPostSchema.parse(req.body);

	const newPost = await createPost(validateData, authorId);
	res.status(201).json({
		success: true,
		data: newPost,
	});
});

export const getActivePosts = asyncHandler(
	async (req: Request, res: Response) => {
		const parsedQueries = postFeedQuerySchema.parse(req.query);
		const limitValue = parseInt(parsedQueries.limit || "10", 10);

		const result = await getAdvancedPostsFeed({
			sort: parsedQueries.sort,
			...(parsedQueries.community
				? { community: parsedQueries.community }
				: {}),
			...(parsedQueries.author ? { author: parsedQueries.author } : {}),
			...(parsedQueries.cursor ? { cursor: parsedQueries.cursor } : {}),
			limit: limitValue,
		});

		res.status(200).json({
			success: true,
			data: result.posts,
			nextCursor: result.nextCursor,
		});
	},
);

export const getPost = asyncHandler(async (req: Request, res: Response) => {
	const { id } = postIdParamSchema.parse(req.params);
	const data = await getPostById(id);
	res.status(200).json({ success: true, data });
});

export const patchPost = asyncHandler(async (req: Request, res: Response) => {
	const { id } = postIdParamSchema.parse(req.params);
	const validatedBody = updatePostSchema.parse(req.body);

	const updatePayload: { title?: string; content?: string } = {};
	if (validatedBody.title !== undefined)
		updatePayload.title = validatedBody.title;
	if (validatedBody.content !== undefined)
		updatePayload.content = validatedBody.content;

	const data = await updatePostFields(
		id,
		res.locals.user.userId,
		updatePayload,
	);
	res.status(200).json({ success: true, data });
});

export const removePost = asyncHandler(async (req: Request, res: Response) => {
	const { id } = postIdParamSchema.parse(req.params);
	const userId = res.locals.user.userId;
	await softDeletePost(id, userId);
	res.status(204).json();
});

export const savePost = asyncHandler(async (req: Request, res: Response) => {
	const { id } = postIdParamSchema.parse(req.params);
	await savePostAction(id, res.locals.user.userId, "SAVE");
	res.status(200).json({ success: true, message: "Post saved successfully" });
});

export const unsavePost = asyncHandler(async (req: Request, res: Response) => {
	const { id } = postIdParamSchema.parse(req.params);
	await savePostAction(id, res.locals.user.userId, "UNSAVE");
	res.status(200).json({ success: true, message: "Post unsaved successfully" });
});

export const toggleModerationFlag = (
	actionType: "PIN" | "LOCK" | "HIDE" | "REPORT",
) => {
	return asyncHandler(async (req: Request, res: Response) => {
		const { id } = postIdParamSchema.parse(req.params);
		const userId = res.locals.user.userId;

		const body = req.body ?? {};
		const reasonText = body.reason ? String(body.reason) : undefined;
		const { isLocked, isPinned } = body;
		await modifyPostModerationState(
			id,
			userId,
			actionType,
			isLocked,
			isPinned,
			reasonText,
		);
		res.status(200).json({
			success: true,
			message: `Operation ${actionType} completed successfully`,
		});
	});
};

export const getVotesData = asyncHandler(
	async (req: Request, res: Response) => {
		const { id } = postVoteParamSchema.parse(req.params);
		const activeUser = res.locals.user?.userId
			? String(res.locals.user.userId)
			: undefined;

		const metrics = await getPostVoteMetrics(id, activeUser);
		res.status(200).json({ success: true, data: metrics });
	},
);

export const handlePostSearch = asyncHandler(async (req, res) => {
	const parsed = postSearchSchema.parse(req.query);
	const result = await searchForPosts(parsed);
	res.status(200).json({
		success: true,
		data: result.posts,
		meta: {
			nextCursor: result.nextCursor,
		},
	});
});
