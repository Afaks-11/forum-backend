import { AppError } from "../errors/AppError.js";
import { commentRepository, postRepository } from "../repositories/index.js";
import { getIO } from "../socket/socket.server.js";
import type { CreateCommentInput } from "../validators/comment.validator.js";
import { sendInternalNotification } from "./notification.service.js";

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
		await sendInternalNotification({
			recipientId: parentComment.authorId,
			senderId: authorId,
			type: "REPLY",
			title: "New reply to your comment",
			content: `Someone replied: "${data.content.substring(0, 30)}..."`,
			link: `/posts/${data.postId}`,
		});

		try {
			const io = getIO();
			io.to(`post:${data.postId}`).emit("comment:new", reply);
		} catch (_socketError) {
			console.warn(
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

	await sendInternalNotification({
		recipientId: postExists.authorId,
		senderId: authorId,
		type: "COMMENT",
		title: "New comment on your post",
		content: `Someone commented: "${data.content.substring(0, 30)}..."`,
		link: `/posts/${data.postId}`,
	});

	try {
		const io = getIO();
		io.to(`post:${data.postId}`).emit("comment:new", comment);
	} catch (_socketError) {
		console.warn(
			"[Live Comments] Socket server offline; falling back to DB storage only.",
		);
	}

	return comment;
};

export const getPostComments = async (postId: string) => {
	return await commentRepository.findManyActiveByPostId(postId);
};

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

export const softDeleteComment = async (commentId: string, userId: string) => {
	const comment = await commentRepository.findById(commentId);
	if (!comment || comment.deletedAt)
		throw new AppError("Comment not found", 404);
	if (comment.authorId !== userId)
		throw new AppError("Unauthorized to delete this comment", 401);

	return await commentRepository.softDelete(commentId);
};

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
		case "LOCK":
			await commentRepository.updateLockState(commentId, !comment.isLocked);
			break;

		case "REMOVE":
			await commentRepository.removeByModerator(commentId);
			break;

		case "REPORT":
			await commentRepository.createCommentReport({
				commentId,
				reporterId: userId,
				reason: reasonText || "Violated community standards guidelines.",
			});
			await sendInternalNotification({
				recipientId: comment.authorId,
				senderId: userId, // The moderator's user ID
				type: "MOD_ACTION",
				title: "Comment removed by moderation guidelines",
				content: `Your comment was removed for violating community code standards. Reason: ${reasonText || "None specified"}`,
				link: `/posts/${comment.postId}`,
			});
			break;

		case "SAVE": {
			const alreadySaved = await commentRepository.findSavedRelation(
				userId,
				commentId,
			);
			if (!alreadySaved) {
				await commentRepository.createSavedRelation(userId, commentId);
			}
			break;
		}
	}
	return { success: true };
};
