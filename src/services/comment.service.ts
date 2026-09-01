import { AppError } from "../errors/AppError.js";
import {
	commentRepository,
	communityRepository,
	postRepository,
	reportRepository,
	userRepository,
} from "../repositories/index.js";
import { getIO } from "../socket/socket.server.js";
import { logger } from "../utils/logger.js";
import { redis } from "../utils/redis.js";
import { isAdmin } from "../utils/roles.js";
import type { CreateCommentInput } from "../validators/comment.validator.js";
import { sendInternalNotification } from "./notification.service.js";

/**
 * Creates a top-level comment or a threaded reply.
 * Locked posts and locked parent threads both reject new entries.
 */
export const createComment = async (
	data: CreateCommentInput,
	authorId: string,
) => {
	const postExists = await postRepository.findById(data.postId);
	if (!postExists) throw new AppError("Post not found", 404);
	if (postExists.isLocked)
		throw new AppError("This posts's comment section is locked", 400);

	if (data.parentId) {
		const parentComment = await commentRepository.findActiveById(data.parentId);
		if (!parentComment) throw new AppError("Parent comment not found", 404);
		if (parentComment.isLocked)
			throw new AppError("This comment thread is locked for replies", 400);

		const reply = await commentRepository.create({
			content: data.content,
			postId: data.postId,
			authorId,
			parentId: data.parentId,
		});
		await redis.del(`post:${data.postId}`);
		await sendInternalNotification({
			recipientId: parentComment.authorId,
			senderId: authorId,
			type: "REPLY",
			dedupeKey: reply.id,
			title: "New reply to your comment",
			content: `Someone replied: "${data.content.substring(0, 30)}..."`,
			link: `/posts/${data.postId}`,
		});

		try {
			const io = getIO();
			io.to(`post:${data.postId}`).emit("comment:new", reply);
		} catch (_socketError) {
			// The reply is already persisted, so a missing socket server must not
			// fail the request — realtime delivery is best-effort on top of the write.
			logger.warn(
				"[Live Comments] Socket server offline; falling back to DB storage only.",
			);
		}

		return reply;
	}

	const comment = await commentRepository.create({
		content: data.content,
		postId: data.postId,
		authorId,
	});
	await redis.del(`post:${data.postId}`);

	await sendInternalNotification({
		recipientId: postExists.authorId,
		senderId: authorId,
		type: "COMMENT",
		dedupeKey: comment.id,
		title: "New comment on your post",
		content: `Someone commented: "${data.content.substring(0, 30)}..."`,
		link: `/posts/${data.postId}`,
	});

	try {
		const io = getIO();
		io.to(`post:${data.postId}`).emit("comment:new", comment);
	} catch (_socketError) {
		logger.warn(
			"[Live Comments] Socket server offline; falling back to DB storage only.",
		);
	}

	return comment;
};

export const getPostComments = async (
	postId: string,
	options: { limit: number; cursor?: string },
) => {
	const post = await postRepository.findById(postId);
	if (!post) throw new AppError("Post not found", 404);

	const result = await commentRepository.findManyByPostId(postId, options);
	return {
		...result,
		comments: result.comments.map((comment) =>
			comment.deletedAt
				? {
						id: comment.id,
						content: "[Comment deleted]",
						postId: comment.postId,
						parentId: comment.parentId,
						authorId: comment.authorId,
						isLocked: comment.isLocked,
						isEdited: comment.isEdited,
						createdAt: comment.createdAt,
						updatedAt: comment.updatedAt,
						deletedAt: comment.deletedAt,
					}
				: comment,
		),
	};
};

/**
 * Edits a comment's body. Author-only; soft-deleted comments are treated as absent.
 */
export const updateCommentFields = async (
	commentId: string,
	userId: string,
	content: string,
) => {
	const comment = await commentRepository.findById(commentId);
	if (!comment || comment.deletedAt)
		throw new AppError("Comment not found", 404);
	if (comment.authorId !== userId)
		throw new AppError("Forbidden: You are not the author", 403);
	return await commentRepository.updateFields(commentId, content);
};

/**
 * Marks a comment deleted without unlinking its replies, keeping the thread
 * structure readable. Author-only.
 */
export const softDeleteComment = async (commentId: string, userId: string) => {
	const comment = await commentRepository.findById(commentId);
	if (!comment || comment.deletedAt)
		throw new AppError("Comment not found", 404);
	if (comment.authorId !== userId)
		throw new AppError("Forbidden: You do not own this comment", 403);

	return await commentRepository.softDelete(commentId);
};

/**
 * Applies a moderation or bookmark action to a comment.
 * LOCK toggles rather than sets, so the caller need not read current state first.
 */
export const modifyCommentState = async (
	commentId: string,
	userId: string,
	action: "LOCK" | "REMOVE" | "SAVE" | "REPORT",
	reasonText?: string,
): Promise<{ success: boolean }> => {
	const comment = await commentRepository.findById(commentId);
	if (!comment || comment.deletedAt)
		throw new AppError("Comment not found", 404);

	switch (action) {
		case "LOCK": {
			await assertCommentModerator(comment.postId, userId);
			await commentRepository.updateLockState(commentId, !comment.isLocked);
			break;
		}

		case "REMOVE":
			await assertCommentModerator(comment.postId, userId);
			await commentRepository.removeByModerator(commentId);
			await sendInternalNotification({
				recipientId: comment.authorId,
				senderId: userId, // The moderator's user ID acting on the thread
				type: "MOD_ACTION",
				dedupeKey: `comment-remove:${commentId}`,
				title: "Comment removed by moderation guidelines",
				content: `Your comment was removed for violating community code standards. Reason: ${reasonText || "None specified"}`,
				link: `/posts/${comment.postId}`,
			});
			break;

		case "REPORT":
			await reportRepository.createComment(
				commentId,
				userId,
				reasonText || "Violated community standards guidelines.",
			);
			break;

		case "SAVE": {
			// Saving is idempotent: a repeat request must not raise a unique
			// constraint violation on the relation.
			await commentRepository.saveComment(userId, commentId);
			break;
		}
	}
	return { success: true };
};

const assertCommentModerator = async (postId: string, userId: string) => {
	const [post, user] = await Promise.all([
		postRepository.findUniqueById(postId),
		userRepository.findById(userId),
	]);
	if (!post || !user)
		throw new AppError("Comment moderation target not found", 404);
	if (isAdmin(user.role)) return;
	if (!post.communityId) {
		throw new AppError("Moderator privileges required", 403);
	}

	const membership = await communityRepository.findModeratorMembership(
		userId,
		post.communityId,
	);
	if (!membership) throw new AppError("Moderator privileges required", 403);
};
