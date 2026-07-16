import type { PrismaClient } from "../generated/prisma/client.js";
import type { CreateCommentInput } from "../validators/comment.validator.js";

export class CommentRepository {
	constructor(private readonly prisma: PrismaClient) {}

	/**
	 * Create a new comment or reply
	 */
	async create(data: CreateCommentInput & { authorId: string }) {
		return await this.prisma.comment.create({
			data: {
				content: data.content,
				postId: data.postId,
				authorId: data.authorId,
				parentId: data.parentId || null,
			},
		});
	}

	/**
	 * Locate any comment by its unique ID
	 */
	async findById(id: string) {
		return await this.prisma.comment.findUnique({
			where: { id },
		});
	}

	/**
	 * Locate an active (non-deleted) comment by ID
	 */
	async findActiveById(id: string) {
		return await this.prisma.comment.findUnique({
			where: { id, deletedAt: null },
		});
	}

	/**
	 * Retrieve all active comments for a post, ordered chronologically
	 */
	async findManyActiveByPostId(postId: string) {
		return await this.prisma.comment.findMany({
			where: {
				postId,
				deletedAt: null,
			},
			include: {
				user: { select: { username: true, id: true } },
			},
			orderBy: { createdAt: "asc" },
		});
	}

	/**
	 * Save inline edits to a comment and mark it as edited
	 */
	async updateFields(id: string, content: string) {
		return await this.prisma.comment.update({
			where: { id },
			data: { content, isEdited: true },
		});
	}

	/**
	 * Standard user soft-deletion (retains database row with timestamps)
	 */
	async softDelete(id: string) {
		return await this.prisma.comment.update({
			where: { id },
			data: { deletedAt: new Date() },
		});
	}

	/**
	 * Toggle the locking mechanism of a comment thread
	 */
	async updateLockState(id: string, isLocked: boolean) {
		return await this.prisma.comment.update({
			where: { id },
			data: { isLocked },
		});
	}

	/**
	 * Force-overwrite sensitive content and mark thread as deleted
	 */
	async removeByModerator(id: string) {
		return await this.prisma.comment.update({
			where: { id },
			data: {
				content: "[Comment removed by moderator]",
				deletedAt: new Date(),
			},
		});
	}

	/**
	 * Retrieve saved association details
	 */
	async findSavedRelation(userId: string, commentId: string) {
		return await this.prisma.savedComment.findUnique({
			where: { userId_commentId: { userId, commentId } },
		});
	}

	/**
	 * Register a user-saved comment bookmark
	 */
	async createSavedRelation(userId: string, commentId: string) {
		return await this.prisma.savedComment.create({
			data: { userId, commentId },
		});
	}

	/**
	 * Log a community standards report against a comment
	 */
	async createCommentReport(data: {
		commentId: string;
		reporterId: string;
		reason: string;
	}) {
		return await this.prisma.commentReport.create({
			data,
		});
	}
}
