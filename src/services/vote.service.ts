import { AppError } from "../errors/AppError.js";
import { postRepository, voteRepository } from "../repositories/index.js";
import {
	isRetryableVoteConflict,
	type VoteResult,
} from "../repositories/vote.repository.js";
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

/**
 * Applies a vote as a three-way toggle: recasting the same type retracts it,
 * a differing type flips it, and no prior vote creates one. The post's
 * denormalized counters move inside the same transaction, and the updated
 * tallies come back so callers need no follow-up read.
 */
export const castVote = async (
	data: CastVoteInput,
	userId: string,
): Promise<VoteResult> => {
	const post = await postRepository.findUniqueById(data.postId);
	if (!post || post.deletedAt) throw new AppError("Post not found", 404);

	if (post.isLocked) {
		throw new AppError("Voting is disabled on a locked post", 403);
	}

	let result: VoteResult;
	try {
		result = await voteRepository.applyVote(userId, data.postId, data.type);
	} catch (error) {
		// Two voters racing on their first vote for the same post: one insert
		// wins, the loser retries and now sees the existing row, so the toggle
		// resolves normally instead of surfacing a constraint error.
		if (!isRetryableVoteConflict(error)) throw error;
		result = await voteRepository.applyVote(userId, data.postId, data.type);
	}

	await invalidateVoteMetrics(data.postId);
	return result;
};
