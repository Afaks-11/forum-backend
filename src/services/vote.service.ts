import { AppError } from "../errors/AppError.js";
import { postRepository, voteRepository } from "../repositories/index.js";
import {
	isRetryableVoteConflict,
	type VoteResult,
} from "../repositories/vote.repository.js";
import { invalidatePostCaches } from "../utils/postCache.js";
import type { CastVoteInput } from "../validators/vote.validator.js";

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
		// wins, the loser retries and now sees the existing row.
		if (!isRetryableVoteConflict(error)) throw error;

		try {
			// `preserveIntent` matters here. On a plain retry the losing insert has
			// already landed, so the toggle would read "same type already present"
			// and delete it — silently discarding a vote the user never retracted.
			// The flag keeps the caller's original intent instead.
			result = await voteRepository.applyVote(
				userId,
				data.postId,
				data.type,
				true,
			);
		} catch (retryError) {
			// Under three-way contention the retry can lose its own race. The
			// predicate is reapplied so that surfaces as a 409 the client can act
			// on rather than an unmapped 500.
			if (!isRetryableVoteConflict(retryError)) throw retryError;

			throw new AppError(
				"Vote could not be recorded due to concurrent activity. Please retry.",
				409,
			);
		}
	}

	// The post detail payload embeds the same tallies this write just moved, so
	// both its cache entry and the vote tally entry are dropped together —
	// otherwise `GET /posts/:id` reported a stale score for up to an hour after a
	// vote that `GET /posts/:id/votes` already reflected.
	await invalidatePostCaches(data.postId);
	return result;
};
