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
	async findManyByPostId(
		postId: string,
		options: { limit: number; cursor?: string } = { limit: 50 },
	) {
		const comments = await this.prisma.comment.findMany({
			where: {
				postId,
			},
			take: options.limit + 1,
			...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
			include: {
				author: { select: { username: true, id: true } },
			},
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		});

		const hasNextPage = comments.length > options.limit;
		if (hasNextPage) comments.pop();

		const lastComment = comments[comments.length - 1];
		return {
			comments,
			nextCursor: hasNextPage && lastComment ? lastComment.id : null,
		};
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
	 * Author soft delete. The row is retained so nested replies keep a valid
	 * parent and the thread does not collapse.
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
	 * Moderator removal. Unlike a user soft delete, the body is overwritten as
	 * well as stamped, so offending content cannot be recovered from the row.
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
	 * Register a user-saved comment bookmark
	 */
	async saveComment(userId: string, commentId: string) {
		return await this.prisma.savedComment.upsert({
			where: { userId_commentId: { userId, commentId } },
			update: {},
			create: { userId, commentId },
		});
	}
}
