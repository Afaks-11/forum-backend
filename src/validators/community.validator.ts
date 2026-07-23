import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const slugParamSchema = z.object({
	slug: z
		.string()
		.min(2)
		.regex(
			/^[a-z0-9-]+$/,
			"Slugs must be lowercase alphanumeric strings with hyphens",
		)
		.openapi({
			description:
				"REQUIRED: The unique URL-safe slug identifying the community.",
			example: "typescript-developers",
		}),
});

export const createCommunitySchema = z
	.object({
		name: z
			.string()
			.min(3, "Community name must be at least 3 characters")
			.max(30, "Community name cannot exceed 30 characters")
			.regex(
				/^[a-zA-Z0-9-]+$/,
				"Name can only contain alphanumeric characters and hyphens",
			)
			.openapi({
				description:
					"REQUIRED: The unique public display name. (e.g. 'NodeJS-Group')",
				example: "NodeJS-Mastery",
			}),
		description: z
			.string()
			.min(10, "Description must be at least 10 characters long")
			.max(200, "Description cannot exceed 200 characters")
			.optional()
			.openapi({
				description:
					"OPTIONAL: A short public statement summarizing the community's theme.",
				example:
					"The ultimate gathering ground for modern backend system engineers.",
			}),
	})
	.openapi("CreateCommunityInput");

export const updateCommunitySchema = z
	.object({
		description: z
			.string()
			.max(500, "Description cannot exceed 500 characters")
			.optional()
			.openapi({
				description:
					"OPTIONAL: Provide a new summary text to update the community profile info.",
				example:
					"Updated description for deep-dive architectural design talks.",
			}),
	})
	.openapi("UpdateCommunityInput");

export const updateRulesSchema = z
	.object({
		rules: z
			.string()
			.min(5, "Rules configuration must be at least 5 characters long")
			.max(2000, "Rules cannot exceed 2000 characters")
			.openapi({
				description:
					"REQUIRED: The complete markdown or plaintext rules guidelines for members to read.",
				example:
					"1. Be civil. 2. Post high-quality content. 3. No unauthorized self-promotion.",
			}),
	})
	.openapi("UpdateRulesInput");

export const updateAvatarSchema = z
	.object({
		avatarUrl: z.url("Must be a valid asset image URL link").openapi({
			description:
				"REQUIRED: A fully qualified secure web link pointing to the new profile square icon image.",
			example:
				"https://images.unsplash.com/photo-1618401471353-b98aedd07871?w=150",
		}),
	})
	.openapi("UpdateAvatarInput");

export const updateBannerSchema = z
	.object({
		bannerUrl: z.string().url("Must be a valid asset image URL link").openapi({
			description:
				"REQUIRED: A fully qualified secure web link pointing to the horizontal community cover background image.",
			example:
				"https://images.unsplash.com/photo-1618401471353-b98aedd07871?w=1200",
		}),
	})
	.openapi("UpdateBannerInput");

export const inviteToCommunitySchema = z.object({
	targetUsername: z.string().min(1, "Target username is required").openapi({
		description:
			"The explicit username profile identifier of the person you want to invite.",
		example: "johndoe",
	}),
});

export const communityResponseSchema = z
	.object({
		id: z.uuid(),
		name: z.string(),
		slug: z.string(),
		description: z.string().nullable(),
		rules: z.string().nullable(),
		avatarUrl: z.string().nullable(),
		bannerUrl: z.string().nullable(),
		creatorId: z.uuid(),
		createdAt: z.date(),
		updatedAt: z.date(),
		_count: z
			.object({
				members: z.number(),
				posts: z.number(),
			})
			.optional(),
	})
	.openapi("CommunityResponse");

export const communityMemberItemSchema = z
	.object({
		id: z.uuid(),
		username: z.string(),
		avatarUrl: z.string().nullable(),
	})
	.openapi("CommunityMemberItem");

export const communityPostItemSchema = z
	.object({
		id: z.uuid(),
		title: z.string(),
		content: z.string(),
		author: z.object({ username: z.string() }),
		createdAt: z.date(),
	})
	.openapi("CommunityPostItem");

export const communityIdParamSchema = z.object({
	id: z.uuid("Invalid community ID format").openapi({
		description:
			"REQUIRED: The unique primary key UUID identifying the target community.",
		example: "b3c4d5e6-7f8a-9b0c-1d2e-3f4a5b6c7d8e",
	}),
});

export const addModeratorSchema = z.object({
	userId: z.uuid("Invalid user ID format").openapi({
		description:
			"REQUIRED: The unique primary key UUID of the user account profile to elevate.",
		example: "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
	}),
});

export const removeModeratorParamSchema = z.object({
	id: z.uuid("Invalid community ID format").openapi({
		description:
			"REQUIRED: The unique primary key UUID of the community workspace.",
	}),
	userId: z.uuid("Invalid user ID format").openapi({
		description:
			"REQUIRED: The unique primary key UUID of the moderator being removed.",
	}),
});

export const communitySearchSchema = z.object({
	query: z
		.string()
		.min(1, "Search query cannot be empty")
		.max(100, "Search query is too long")
		.transform((val) => val.trim()),
	limit: z
		.string()
		.optional()
		.transform((val) => (val ? parseInt(val, 10) : 10))
		.pipe(z.number().int().min(1).max(50)),
});

export const compactCommunitySchema = z.object({
	name: z.string(),
	slug: z.string(),
});

export type CommunitySearchInput = z.infer<typeof communitySearchSchema>;
export type CreateCommunityInput = z.infer<typeof createCommunitySchema>;
export type InviteToCommunityInput = z.infer<typeof inviteToCommunitySchema>;
export type AddModeratorInput = z.infer<typeof addModeratorSchema>;
