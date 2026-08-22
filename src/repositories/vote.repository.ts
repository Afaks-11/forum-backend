import {
	Prisma,
	type PrismaClient,
	type VoteType,
} from "../generated/prisma/client.js";

export type VoteAction = "CREATED" | "CHANGED" | "REMOVED";

export interface VoteResult {
	action: VoteAction;
	score: number;
	upvoteCount: number;
	downvoteCount: number;
	currentUserVote: VoteType | null;
}

/**
 * Counter deltas for each transition. Retracting a vote is the inverse of
 * casting it; flipping is a retraction and a cast in one step, which is why a
 * flip moves `score` by two.
 */
const deltaFor = (
	action: VoteAction,
	type: VoteType,
): { up: number; down: number } => {
	const sign = action === "REMOVED" ? -1 : 1;
	const primary =
		type === "UPVOTE" ? { up: sign, down: 0 } : { up: 0, down: sign };

	if (action !== "CHANGED") return primary;

	return type === "UPVOTE" ? { up: 1, down: -1 } : { up: -1, down: 1 };
};

export class VoteRepository {
	constructor(private readonly prisma: PrismaClient) {}

	/**
	 * Applies a vote as a three-way toggle and moves the post's denormalized
	 * counters in the same transaction, so the tallies can never disagree with
	 * the `votes` rows they summarize.
	 *
	 * Correctness under concurrency rests on two things: the counter writes use
	 * SQL-level `increment`, so simultaneous voters cannot clobber each other's
	 * update, and the `(userId, postId)` unique means a racing double-cast
	 * surfaces as P2002 rather than a duplicate row. The caller retries that
	 * case, at which point the existing vote is visible and the toggle resolves
	 * normally.
	 */
	async applyVote(
		userId: string,
		postId: string,
		type: VoteType,
	): Promise<VoteResult> {
		return await this.prisma.$transaction(async (tx) => {
			const existing = await tx.vote.findUnique({
				where: { userId_postId: { userId, postId } },
				select: { id: true, type: true },
			});

			let action: VoteAction;

			if (!existing) {
				await tx.vote.create({ data: { userId, postId, type } });
				action = "CREATED";
			} else if (existing.type === type) {
				await tx.vote.delete({ where: { id: existing.id } });
				action = "REMOVED";
			} else {
				await tx.vote.update({ where: { id: existing.id }, data: { type } });
				action = "CHANGED";
			}

			const { up, down } = deltaFor(action, type);

			const post = await tx.post.update({
				where: { id: postId },
				data: {
					upvoteCount: { increment: up },
					downvoteCount: { increment: down },
					score: { increment: up - down },
				},
				select: { upvoteCount: true, downvoteCount: true, score: true },
			});

			return {
				action,
				score: post.score,
				upvoteCount: post.upvoteCount,
				downvoteCount: post.downvoteCount,
				currentUserVote: action === "REMOVED" ? null : type,
			};
		});
	}

	/**
	 * Recomputes one post's counters from its vote rows.
	 *
	 * The transactional path above keeps counters exact in normal operation;
	 * this exists for reconciliation after a restore or manual data edit, where
	 * the derived columns may have drifted from the source table.
	 */
	async resyncCounters(postId: string) {
		const [upvoteCount, downvoteCount] = await Promise.all([
			this.prisma.vote.count({ where: { postId, type: "UPVOTE" } }),
			this.prisma.vote.count({ where: { postId, type: "DOWNVOTE" } }),
		]);

		return await this.prisma.post.update({
			where: { id: postId },
			data: {
				upvoteCount,
				downvoteCount,
				score: upvoteCount - downvoteCount,
			},
			select: { upvoteCount: true, downvoteCount: true, score: true },
		});
	}
}

/**
 * True for the two Postgres failures a concurrent vote can legitimately raise:
 * a lost race to insert the first vote, and a serialization conflict.
 */
export const isRetryableVoteConflict = (error: unknown): boolean => {
	if (error instanceof Prisma.PrismaClientKnownRequestError) {
		return error.code === "P2002" || error.code === "P2034";
	}
	return false;
};
