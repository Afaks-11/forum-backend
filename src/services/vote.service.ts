import type { VoteType } from "../generated/prisma/client.js";
import { postRepository, voteRepository } from "../repositories/index.js";
import type { CastVoteInput } from "../validators/vote.validator.js";

export const castVote = async (data: CastVoteInput, userId: string) => {
	const post = await postRepository.findById(data.postId);
	if (!post) throw new Error("Post not found");

	const existingVote = await voteRepository.findUniqueVote(userId, data.postId);

	if (existingVote) {
		if (existingVote.type === data.type) {
			await voteRepository.deleteVote(existingVote.id);
			return { action: "REMOVED" };
		}

		const updateVote = await voteRepository.updateVote(
			existingVote.id,
			data.type as VoteType,
		);
		return { action: "CHANGED", vote: updateVote };
	}

	const newVote = await voteRepository.createVote({
		userId,
		postId: data.postId,
		type: data.type as VoteType,
	});
	return { action: "CREATED", vote: newVote };
};
