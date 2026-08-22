import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Adds `.openapi()` to the shared Zod instance. Repeated per module because
// import order is not guaranteed; the call is idempotent.
extendZodWithOpenApi(z);

export const castVoteSchema = z.object({
	postId: z.uuid("Invalid post ID format").openapi({
		description: "REQUIRED: Target post primary key UUID.",
		example: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
	}),
	type: z.enum(["UPVOTE", "DOWNVOTE"]).openapi({
		description:
			"REQUIRED: Casting the type already held retracts the vote; casting the opposite flips it.",
		example: "UPVOTE",
	}),
});

export const voteResultSchema = z
	.object({
		action: z.enum(["CREATED", "CHANGED", "REMOVED"]).openapi({
			description:
				"Which branch of the toggle ran: a new vote, a flip, or a retraction.",
		}),
		score: z.number().int(),
		upvoteCount: z.number().int(),
		downvoteCount: z.number().int(),
		currentUserVote: z
			.enum(["UPVOTE", "DOWNVOTE"])
			.nullable()
			.openapi({ description: "Null once the vote has been retracted." }),
	})
	.openapi("VoteResult");

export type CastVoteInput = z.infer<typeof castVoteSchema>;
