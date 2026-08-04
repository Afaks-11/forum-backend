import { AppError } from "../errors/AppError.js";
import type { VoteType } from "../generated/prisma/client.js";
import { postRepository, voteRepository } from "../repositories/index.js";
import { redis } from "../utils/redis.js";
import type { CastVoteInput } from "../validators/vote.validator.js";

/**
 * Drops the cached vote metrics for a post after its tally changes.
 *
 * `getPostVoteMetrics` caches under `post:<id>:vote_metrics:<viewerId>` — one
 * entry per viewer, because the payload carries that viewer's own vote. A
 * single `del` would therefore only clear the caster's copy and leave every
 * other reader on a stale score for the rest of the 60s TTL, so the whole
 * per-post family is swept.
 */
const invalidateVoteMetrics = async (postId: string): Promise<void> => {
	await redis.delPattern(`post:${postId}:vote_metrics:*`);
};

export const castVote = async (data: CastVoteInput, userId: string) => {
	const post = await postRepository.findById(data.postId);
	if (!post) throw new AppError("Post not found", 404);

	const existingVote = await voteRepository.findUniqueVote(userId, data.postId);
	if (existingVote) {
		if (existingVote.type === data.type) {
			await voteRepository.deleteVote(existingVote.id);
			await invalidateVoteMetrics(data.postId);
			return { action: "REMOVED" };
		}

		const updateVote = await voteRepository.updateVote(
			existingVote.id,
			data.type as VoteType,
		);
		await invalidateVoteMetrics(data.postId);
		return { action: "CHANGED", vote: updateVote };
	}

	const newVote = await voteRepository.createVote({
		userId,
		postId: data.postId,
		type: data.type as VoteType,
	});
	await invalidateVoteMetrics(data.postId);
	return { action: "CREATED", vote: newVote };
};
