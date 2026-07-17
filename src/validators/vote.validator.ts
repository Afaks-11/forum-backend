import { z } from "zod";

export const castVoteSchema = z.object({
	postId: z.uuid("Invalid post ID format"),
	type: z.enum(["UPVOTE", "DOWNVOTE"]),
});

export type CastVoteInput = z.infer<typeof castVoteSchema>;
