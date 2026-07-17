import type { PrismaClient, VoteType } from "../generated/prisma/client.js";

export class VoteRepository {
	constructor(private readonly prisma: PrismaClient) {}

	/**
	 * Look up an existing vote using the compound unique identifier
	 */
	async findUniqueVote(userId: string, postId: string) {
		return await this.prisma.vote.findUnique({
			where: {
				userId_postId: { userId, postId },
			},
		});
	}

	/**
	 * Create a new vote record
	 */
	async createVote(data: { userId: string; postId: string; type: VoteType }) {
		return await this.prisma.vote.create({
			data: {
				type: data.type,
				userId: data.userId,
				postId: data.postId,
			},
		});
	}

	/**
	 * Update an existing vote type (e.g., UPVOTE to DOWNVOTE)
	 */
	async updateVote(id: string, type: VoteType) {
		return await this.prisma.vote.update({
			where: { id },
			data: { type },
		});
	}

	/**
	 * Delete/Retract a vote
	 */
	async deleteVote(id: string) {
		return await this.prisma.vote.delete({
			where: { id },
		});
	}
}
