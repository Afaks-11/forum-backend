import {
	OpenAPIRegistry,
	OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
	changePasswordSchema,
	forgotPasswordSchema,
	genericResponseSchema,
	loginResponseSchema,
	loginSchema,
	profileResponseWrapper,
	refreshTokenResponseSchema,
	registerSchema,
	resendTokenSchema,
	resetPasswordSchema,
	updateMeSchema,
	userResponseSchema,
	verifyEmailSchema,
} from "../validators/auth.validator.js";
import {
	commentIdParamSchema,
	commentResponseSchema,
	createCommentSchema,
	updateCommentSchema,
} from "../validators/comment.validator.js";
import {
	addModeratorSchema,
	communityIdParamSchema,
	communityMemberItemSchema,
	communityPostItemSchema,
	communityResponseSchema,
	createCommunitySchema,
	inviteToCommunitySchema,
	removeModeratorParamSchema,
	slugParamSchema,
	updateAvatarSchema,
	updateBannerSchema,
	updateCommunitySchema,
	updateRulesSchema,
} from "../validators/community.validator.js";
import { feedPostItemSchema } from "../validators/feed.validator.js";
import {
	DeepReadinessSchema,
	HealthStatusSchema,
} from "../validators/health.validator.js";
import {
	createPostSchema,
	postFeedQuerySchema,
	postFeedResponseSchema,
	postIdParamSchema,
	postResponseSchema,
	postVotesDataSchema,
	updatePostSchema,
} from "../validators/post.validator.js";
import { recommendedCommunityItemSchema } from "../validators/recommendation.validator.js";
import {
	profileCommentItemSchema,
	profilePostItemSchema,
	standardMessageResponseSchema,
	usernameParamSchema,
	userProfileResponseSchema,
} from "../validators/user.validator.js";

const registry = new OpenAPIRegistry();
const communityTag = "Communities Management";
const postsTag = "Posts & Interactions Operations";
const commentsTag = "Comment Management Engine";
const usersTag = "User Profiles & Social Graph";
const uploadsTag = "Media & Asset Uploads";
const recommendationTag = "Recommendations";
const healthTags = "Infrastructure";

const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
	type: "http",
	scheme: "bearer",
	bearerFormat: "JWT",
	description:
		"Enter your short-lived access JWT token here. The backend automatically extracts your userId from this token.",
});

registry.registerPath({
	method: "post",
	path: "/auth/register",
	summary: "Register a user",
	tags: ["Authentication"],
	request: {
		body: { content: { "application/json": { schema: registerSchema } } },
	},
	responses: {
		201: {
			description: "User created successfully",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: userResponseSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/auth/login",
	summary: "Log in a user",
	tags: ["Authentication"],
	request: {
		body: { content: { "application/json": { schema: loginSchema } } },
	},
	responses: {
		200: {
			description:
				"Logged in successfully. Returns access token and drops HttpOnly refresh cookie.",
			headers: {
				"Set-Cookie": {
					description:
						"HttpOnly Refresh Token used to generate new access tokens.",
					schema: { type: "string" },
				},
			},
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: loginResponseSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/auth/me",
	summary: "Get current user profile details",
	tags: ["Authentication"],
	description:
		"Requires valid Bearer Token. The system extracts the userId internally from the token state.",
	security: [{ [bearerAuth.name]: [] }],
	responses: {
		200: {
			description:
				"Returns the private profile fields for the authenticated user",
			content: { "application/json": { schema: profileResponseWrapper } },
		},
	},
});

registry.registerPath({
	method: "patch",
	path: "/auth/me",
	summary: "Update current user profile info",
	tags: ["Authentication"],
	description:
		"Requires valid Bearer Token. The user id is extracted automatically from the authorization context.",
	security: [{ [bearerAuth.name]: [] }],
	request: {
		body: { content: { "application/json": { schema: updateMeSchema } } },
	},
	responses: {
		201: {
			description: "Profile modified successfully",
			content: { "application/json": { schema: profileResponseWrapper } },
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/auth/change-password",
	summary: "Update account password while authenticated",
	tags: ["Authentication"],
	description:
		"Requires session context token. Validates old credentials before saving updates.",
	security: [{ [bearerAuth.name]: [] }],
	request: {
		body: { content: { "application/json": { schema: changePasswordSchema } } },
	},
	responses: {
		201: {
			description: "Password swapped successfully",
			content: { "application/json": { schema: genericResponseSchema } },
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/auth/forgot-password",
	summary: "Trigger reset token email dispatch",
	tags: ["Authentication"],
	request: {
		body: { content: { "application/json": { schema: forgotPasswordSchema } } },
	},
	responses: {
		200: {
			description: "Secure hex token recorded and notification outboxed",
			content: { "application/json": { schema: genericResponseSchema } },
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/auth/reset-password",
	summary: "Overwrite old credentials using outboxed reset token",
	tags: ["Authentication"],
	request: {
		body: { content: { "application/json": { schema: resetPasswordSchema } } },
	},
	responses: {
		200: {
			description: "Password reset complete",
			content: { "application/json": { schema: genericResponseSchema } },
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/auth/verify-email",
	summary: "Validate registration token",
	tags: ["Authentication"],
	request: {
		body: { content: { "application/json": { schema: verifyEmailSchema } } },
	},
	responses: {
		200: {
			description: "Email flag verified successfully",
			content: { "application/json": { schema: genericResponseSchema } },
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/auth/resend-verification",
	summary: "Re-generate and dispatch email validation token",
	tags: ["Authentication"],
	request: {
		body: { content: { "application/json": { schema: resendTokenSchema } } },
	},
	responses: {
		200: {
			description: "New random verification token sent",
			content: { "application/json": { schema: genericResponseSchema } },
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/auth/logout",
	summary: "Clear session cookies",
	tags: ["Authentication"],
	responses: { 200: { description: "Session ended cleanly" } },
});

registry.registerPath({
	method: "post",
	path: "/auth/refresh",
	summary: "Exchange refresh token for a brand new access token",
	tags: ["Authentication"],
	responses: {
		200: {
			description: "New access credentials generated",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: refreshTokenResponseSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "delete",
	path: "/auth/me",
	summary: "Purge user workspace account entirely",
	tags: ["Authentication"],
	security: [{ [bearerAuth.name]: [] }],
	responses: { 204: { description: "User removed cleanly" } },
});

// User
registry.registerPath({
	method: "get",
	path: "/users/{username}",
	summary: "Fetch public profile by username",
	tags: [usersTag],
	request: {
		params: usernameParamSchema,
	},
	responses: {
		200: {
			description: "Profile aggregates retrieved successfully",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: userProfileResponseSchema,
					}),
				},
			},
		},
		404: { description: "User target profile not found" },
	},
});

registry.registerPath({
	method: "get",
	path: "/users/{username}/posts",
	summary: "Fetch all active posts authored by a user",
	tags: [usersTag],
	request: {
		params: usernameParamSchema,
	},
	responses: {
		200: {
			description: "Array listing of user posts returned successfully",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.array(profilePostItemSchema),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/users/{username}/comments",
	summary: "Fetch all active comments authored by a user",
	tags: [usersTag],
	request: {
		params: usernameParamSchema,
	},
	responses: {
		200: {
			description: "Array listing of user comments returned successfully",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.array(profileCommentItemSchema),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/users/{username}/follow",
	summary: "Follow a user profile",
	tags: [usersTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: usernameParamSchema,
	},
	responses: {
		200: {
			description: "Follow relationship established successfully",
			content: {
				"application/json": {
					schema: standardMessageResponseSchema,
				},
			},
		},
	},
});

registry.registerPath({
	method: "delete",
	path: "/users/{username}/unfollow",
	summary: "Unfollow a user profile",
	tags: [usersTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: usernameParamSchema,
	},
	responses: {
		200: {
			description: "Follow relationship terminated safely",
			content: {
				"application/json": {
					schema: standardMessageResponseSchema,
				},
			},
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/users/{username}/block",
	summary: "Block a user profile",
	tags: [usersTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: usernameParamSchema,
	},
	responses: {
		200: {
			description: "Target user blacklisted from communications and views",
			content: {
				"application/json": {
					schema: standardMessageResponseSchema,
				},
			},
		},
	},
});

registry.registerPath({
	method: "delete",
	path: "/users/{username}/unblock",
	summary: "Unblock a user profile",
	tags: [usersTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: usernameParamSchema,
	},
	responses: {
		200: {
			description: "User profile restriction unlinked successfully",
			content: {
				"application/json": {
					schema: standardMessageResponseSchema,
				},
			},
		},
	},
});

// Communities
registry.registerPath({
	method: "post",
	path: "/communities",
	summary: "Create a new community space",
	tags: ["Communities Management"],
	security: [{ bearerAuth: [] }],
	request: {
		body: {
			content: {
				"application/json": {
					schema: createCommunitySchema,
				},
			},
		},
	},
	responses: {
		201: {
			description:
				"Community created successfully. The creator is automatically assigned as a MODERATOR.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: communityResponseSchema,
					}),
				},
			},
		},
		409: {
			description: "A community with this exact name or slug already exists.",
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/communities/{slug}/invite",
	summary:
		"Invite an external user account to join a specific community space workspace",
	tags: [communityTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: slugParamSchema,
		body: {
			content: {
				"application/json": {
					schema: inviteToCommunitySchema,
				},
			},
		},
	},
	responses: {
		200: {
			description:
				"Invitation processed and inbox event lifecycle notification dispatched successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
		400: {
			description: "Input fields validation checking parsing error.",
		},
		404: {
			description:
				"The specified community slug or target username string account details could not be found.",
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/communities",
	summary: "Browse all available public community spaces",
	tags: [communityTag],
	responses: {
		200: {
			description:
				"Returns an array listing all registered public group spaces along with member counts.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.array(communityResponseSchema),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/communities/{slug}",
	summary: "Get specific community details",
	tags: [communityTag],
	request: { params: slugParamSchema },
	responses: {
		200: {
			description:
				"Returns full community metadata profile including guidelines and imagery assets.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: communityResponseSchema,
					}),
				},
			},
		},
		404: { description: "Community space not found." },
	},
});

registry.registerPath({
	method: "patch",
	path: "/communities/{slug}",
	summary: "Modify general community profile information data",
	tags: [communityTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: slugParamSchema,
		body: {
			content: { "application/json": { schema: updateCommunitySchema } },
		},
	},
	responses: {
		200: {
			description: "General configurations modified successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: communityResponseSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "delete",
	path: "/communities/{slug}",
	summary: "Permanently delete a community",
	tags: [communityTag],
	security: [{ bearerAuth: [] }],
	request: { params: slugParamSchema },
	responses: {
		204: {
			description:
				"Community completely deleted from the database. (Creator-only action)",
		},
		403: {
			description:
				"Forbidden: You do not possess structural ownership permissions over this area.",
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/communities/{slug}/join",
	summary: "Join community roster as a standard member",
	tags: [communityTag],
	security: [{ bearerAuth: [] }],
	request: { params: slugParamSchema },
	responses: {
		200: {
			description: "Membership record generated successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "delete",
	path: "/communities/{slug}/leave",
	summary: "Leave community space",
	tags: [communityTag],
	security: [{ bearerAuth: [] }],
	request: { params: slugParamSchema },
	responses: { 204: { description: "Membership severed successfully." } },
});

registry.registerPath({
	method: "get",
	path: "/communities/{slug}/posts",
	summary: "Get all posts published within this community",
	tags: [communityTag],
	request: { params: slugParamSchema },
	responses: {
		200: {
			description:
				"Returns full feed array of items matching this specific communityId context.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.array(communityPostItemSchema),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/communities/{slug}/members",
	summary: "Fetch active membership roster",
	tags: [communityTag],
	request: { params: slugParamSchema },
	responses: {
		200: {
			description:
				"Returns array list of user tracking data registered as standard MEMBERS.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.array(communityMemberItemSchema),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/communities/{slug}/moderators",
	summary: "Fetch executive moderator team roster",
	tags: [communityTag],
	request: { params: slugParamSchema },
	responses: {
		200: {
			description:
				"Returns list of administrative accounts assigned the MODERATOR role.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.array(communityMemberItemSchema),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "patch",
	path: "/communities/{slug}/rules",
	summary: "Modify operational code of conduct rules text",
	tags: [communityTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: slugParamSchema,
		body: { content: { "application/json": { schema: updateRulesSchema } } },
	},
	responses: {
		200: {
			description: "Community guidelines rules updated.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: communityResponseSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "patch",
	path: "/communities/{slug}/avatar",
	summary: "Change community icon avatar image",
	tags: [communityTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: slugParamSchema,
		body: { content: { "application/json": { schema: updateAvatarSchema } } },
	},
	responses: {
		200: {
			description: "Avatar url column successfully updated.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: communityResponseSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "patch",
	path: "/communities/{slug}/banner",
	summary: "Update horizontal cover background banner asset",
	tags: [communityTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: slugParamSchema,
		body: { content: { "application/json": { schema: updateBannerSchema } } },
	},
	responses: {
		200: {
			description: "Banner url string modified successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: communityResponseSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/communities/{id}/moderators",
	summary: "Appoint and grant moderator privileges to an existing member user",
	description:
		"ACCESS CONTROL: Only active, verified community moderators possess authorization to execute this expansion task.",
	tags: [communityTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: communityIdParamSchema,
		body: {
			content: {
				"application/json": { schema: addModeratorSchema },
			},
		},
	},
	responses: {
		200: {
			description:
				"User account role record systematically elevated successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
		403: {
			description:
				"Forbidden: Requestor lacks necessary management credentials over this group.",
		},
		404: {
			description:
				"Target community ID database track or user ID account record not found.",
		},
	},
});

registry.registerPath({
	method: "delete",
	path: "/communities/{id}/moderators/{userId}",
	summary:
		"Revoke moderator authority privileges and remove user from management board",
	description:
		"ACCESS CONTROL: Only active, verified community moderators possess authorization to remove or strip authority states.",
	tags: [communityTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: removeModeratorParamSchema,
	},
	responses: {
		200: {
			description:
				"User account role downgraded and removed from authority tracking grids cleanly.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
		403: {
			description:
				"Forbidden: Action actor missing admin permissions profile configurations.",
		},
		404: { description: "Specified association record parameters mismatch." },
	},
});

//Post
registry.registerPath({
	method: "post",
	path: "/posts",
	summary: "Create a brand new text or link post element",
	tags: [postsTag],
	security: [{ bearerAuth: [] }],
	request: {
		body: { content: { "application/json": { schema: createPostSchema } } },
	},
	responses: {
		201: {
			description: "Post created successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: postResponseSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/posts",
	summary:
		"Fetch standard or aggregated post feed timeline with pagination limit of 10",
	tags: [postsTag],
	request: { query: postFeedQuerySchema },
	responses: {
		200: {
			description: "Returns array list of matching post entities.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: postFeedResponseSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/posts/{id}",
	summary: "Fetch specific post data details by UUID key",
	tags: [postsTag],
	request: { params: postIdParamSchema },
	responses: {
		200: {
			description: "Post object dictionary payload fetched successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: postFeedResponseSchema,
					}),
				},
			},
		},
		404: { description: "Target post entity could not be found." },
	},
});

registry.registerPath({
	method: "get",
	path: "/posts/{id}/votes",
	summary: "Fetch aggregate upvote/downvote scores for a post",
	tags: [postsTag],
	request: {
		params: z.object({
			id: z.uuid().openapi({ example: "d3b07384-d113-4956-a5dc-e0c21171a7a1" }),
		}),
	},
	responses: {
		200: {
			description:
				"Returns aggregate numbers alongside requesting user's relative selection state status.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: postVotesDataSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "patch",
	path: "/posts/{id}",
	summary: "Modify the headline title or structural text block of a post",
	tags: [postsTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: postIdParamSchema,
		body: { content: { "application/json": { schema: updatePostSchema } } },
	},
	responses: {
		200: {
			description: "Post content values records successfully customized.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: postResponseSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "delete",
	path: "/posts/{id}",
	summary: "Mark an active post as removed from the system feed timeline",
	tags: [postsTag],
	security: [{ bearerAuth: [] }],
	request: { params: postIdParamSchema },
	responses: { 204: { description: "Post successfully marked as deleted." } },
});

registry.registerPath({
	method: "post",
	path: "/posts/{id}/save",
	summary: "Bookmark a post to save it inside the user's personal archive",
	tags: [postsTag],
	security: [{ bearerAuth: [] }],
	request: { params: postIdParamSchema },
	responses: {
		200: {
			description: "Post link saved successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/posts/search",
	summary: "Search posts text vectors with cursor pagination",
	tags: [postsTag],
	request: {
		query: z.object({
			q: z.string().min(1).openapi({
				description: "Keywords to match against title or content",
				example: "typescript errors",
			}),
			limit: z
				.string()
				.optional()
				.openapi({ description: "Pagination page size", example: "10" }),
			cursor: z.string().optional().openapi({
				description:
					"Opaque database record ID to sequence next viewport link step",
				example: "a6c5dbb0-8f64-42b4-82ee-c1b1842813df",
			}),
		}),
	},
	responses: {
		200: {
			description: "Returns paginated list of matching post entities.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.array(feedPostItemSchema),
						meta: z.object({ nextCursor: z.string().nullable() }),
					}),
					example: {
						success: true,
						data: [
							{
								id: "a6c5dbb0-8f64-42b4-82ee-c1b1842813df",
								title: "Fixing exactOptionalPropertyTypes in TypeScript",
								content:
									"Here is a clean production approach to handle undefined matching maps...",
								createdAt: "2026-07-17T21:00:00.000Z",
								deletedAt: null,
								isLocked: false,
								authorId: "u83d6cb4-4bf8-4682-8bc7-e316d29df83e",
								communityId: "c29dbb40-8f64-42b4-82ee-c1b1842813da",
								user: { username: "dev_wizard" },
								community: { name: "TypeScript Core", slug: "typescript" },
								_count: { comment: 14, votes: 89 },
							},
						],
						meta: { nextCursor: "b1d5cda0-9f12-43c4-91fe-d1c1842813ec" },
					},
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/posts/feed",
	summary:
		"Fetch advanced chronologically sorted or algorithmically ranked global/contextual post feeds",
	tags: [postsTag],
	request: {
		query: z.object({
			sort: z.enum(["new", "top", "hot", "controversial"]).optional().openapi({
				description: "Ranking strategy identifier link",
				example: "hot",
			}),
			community: z.string().optional().openapi({
				description: "Filter items scoped only to a specific community slug",
				example: "typescript",
			}),
			author: z.string().optional().openapi({
				description: "Filter items scoped to an author's username",
				example: "dev_wizard",
			}),
			limit: z.string().optional().openapi({
				description: "Total item row window limit execution bounds",
				example: "10",
			}),
			cursor: z.string().optional().openapi({
				description:
					"Pagination marker (Database item ID or Redis index position count string)",
				example: "10",
			}),
		}),
	},
	responses: {
		200: {
			description:
				"Returns an array of hydrated feed records organized according to requested sorting metrics.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.array(feedPostItemSchema),
						meta: z.object({ nextCursor: z.string().nullable() }),
					}),
					example: {
						success: true,
						data: [
							{
								id: "f83dbb40-8f64-42b4-82ee-c1b1842813aa",
								title: "Breaking Changes coming to ECMAScript 2027",
								content:
									"An early engineering analysis of planned runtimes update strategies...",
								createdAt: "2026-07-17T18:45:12.000Z",
								deletedAt: null,
								isLocked: false,
								authorId: "u83d6cb4-4bf8-4682-8bc7-e316d29df83e",
								communityId: "c29dbb40-8f64-42b4-82ee-c1b1842813da",
								user: { username: "tc39_watcher" },
								community: {
									name: "JavaScript Engineering",
									slug: "javascript",
								},
								_count: { comment: 142, votes: 912 },
							},
						],
						meta: { nextCursor: "20" },
					},
				},
			},
		},
	},
});

registry.registerPath({
	method: "delete",
	path: "/posts/{id}/save",
	summary: "Remove post from user saved bookmarks",
	tags: [postsTag],
	security: [{ bearerAuth: [] }],
	request: { params: postIdParamSchema },
	responses: {
		200: {
			description: "Post link removed from saved list.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/posts/{id}/pin",
	summary: "Toggle the pinned status flag of a post",
	tags: [postsTag],
	security: [{ bearerAuth: [] }],
	request: { params: postIdParamSchema },
	responses: {
		200: {
			description: "Pinned state changed successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/posts/{id}/lock",
	summary:
		"Toggle the locked status flag to close or open a post comment section",
	tags: [postsTag],
	security: [{ bearerAuth: [] }],
	request: { params: postIdParamSchema },
	responses: {
		200: {
			description: "Comment lock structural state updated.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/posts/{id}/hide",
	summary: "Toggle the visibility profile flag of a target post element",
	tags: [postsTag],
	security: [{ bearerAuth: [] }],
	request: { params: postIdParamSchema },
	responses: {
		200: {
			description: "Feed discovery visibility rule flipped successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/posts/{id}/report",
	summary: "File a community guidelines safety report against a post",
	tags: [postsTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: postIdParamSchema,
		body: {
			content: {
				"application/json": {
					schema: z.object({
						reason: z.string().min(5).openapi({
							description: "The reason why this post is violating rules.",
							example: "Spam content",
						}),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Content successfully flagged for moderator review queues.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

// Comment
registry.registerPath({
	method: "post",
	path: "/comments",
	summary:
		"Create a top-level comment or a reply thread to an existing comment",
	tags: [commentsTag],
	security: [{ bearerAuth: [] }],
	request: {
		body: {
			content: {
				"application/json": {
					schema: createCommentSchema,
				},
			},
		},
	},
	responses: {
		201: {
			description: "Comment or reply successfully recorded.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: commentResponseSchema,
					}),
				},
			},
		},
		400: {
			description:
				"Validation failed, or the target post/comment thread is locked.",
		},
		404: {
			description:
				"The targeted Post ID or Parent Comment ID could not be found.",
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/comments/post/{postId}",
	summary:
		"Fetch the chronological list of active comments for a specific post",
	tags: [commentsTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: z.object({
			postId: z.uuid().openapi({
				description: "The unique UUID of the parent post.",
				example: "8f3b202c-819a-4d22-9653-3b60e6b5a34c",
			}),
		}),
	},
	responses: {
		200: {
			description:
				"An array list containing all non-deleted comments associated with the target post identifier.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.array(commentResponseSchema),
					}),
				},
			},
		},
		404: { description: "Target post ID parent container not found." },
	},
});

registry.registerPath({
	method: "patch",
	path: "/comments/{id}",
	summary: "Update the textual body markdown string of a comment",
	tags: [commentsTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: commentIdParamSchema,
		body: { content: { "application/json": { schema: updateCommentSchema } } },
	},
	responses: {
		200: {
			description:
				"Returns the updated comment model showing 'isEdited: true'.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: commentResponseSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "delete",
	path: "/comments/{id}",
	summary: "Soft delete author's own comment",
	tags: [commentsTag],
	security: [{ bearerAuth: [] }],
	request: { params: commentIdParamSchema },
	responses: { 204: { description: "Comment successfully removed." } },
});

registry.registerPath({
	method: "post",
	path: "/comments/{id}/lock",
	summary:
		"Toggle structural lock to suspend children replies under this comment block",
	tags: [commentsTag],
	security: [{ bearerAuth: [] }],
	request: { params: commentIdParamSchema },
	responses: {
		200: {
			description: "Comment thread lock status changed successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/comments/{id}/remove",
	summary:
		"Moderator utility to flag content as admin-removed from timeline viewports",
	tags: [commentsTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: commentIdParamSchema,
	},
	responses: {
		200: {
			description: "Target content hidden from consumer views successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/comments/{id}/report",
	summary: "File a community violation report against a comment",
	tags: [commentsTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: commentIdParamSchema,
		body: {
			content: {
				"application/json": {
					schema: z.object({
						reason: z.string().min(5).openapi({ example: "Harassment" }),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Item submitted to compliance queues for active review.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "post",
	path: "/comments/{id}/save",
	summary: "Toggle a comment item to the requester's secure personal archive",
	tags: [commentsTag],
	security: [{ bearerAuth: [] }],
	request: {
		params: commentIdParamSchema,
	},
	responses: {
		200: {
			description: "Comment successfully bookmarked.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

//Upload
registry.registerPath({
	method: "get",
	path: "/uploads/signature",
	summary: "Generate a secure direct-to-cloud upload signature",
	description:
		"Returns cryptographic credentials allowing the client to upload a file directly to Cloudinary without passing through the Node server.",
	tags: [uploadsTag],
	security: [{ bearerAuth: [] }],
	request: {
		query: z.object({
			folder: z.enum(["avatars", "banners", "posts"]).openapi({
				description: "Target directory for the upload.",
				example: "avatars",
			}),
		}),
	},
	responses: {
		200: {
			description: "Cryptographic signature generated successfully.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.object({
							timestamp: z.number(),
							signature: z.string(),
							cloudName: z.string(),
							apiKey: z.string(),
							folder: z.string(),
						}),
					}),
				},
			},
		},
	},
});

// Recommended Communities
registry.registerPath({
	method: "get",
	path: "/recommendations/communities",
	summary:
		"Retrieve personalized or high-activity community space recommendations",
	tags: [recommendationTag],
	description:
		"Identifies spaces matching historic user interaction maps that they have not joined yet. Drops back dynamically to popular global items for unauthenticated casual traffic.",
	request: {
		query: z.object({
			limit: z.string().optional().openapi({
				description: "Total recommended items count limit bounds",
				example: "3",
			}),
		}),
	},
	responses: {
		200: {
			description: "Returns recommended community entities.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.array(recommendedCommunityItemSchema),
					}),
					example: {
						success: true,
						data: [
							{
								id: "d83dbb40-8f64-42b4-82ee-c1b1842813cc",
								name: "Rust Systems Dev",
								slug: "rust-systems",
								_count: { members: 4890, posts: 241 },
							},
						],
					},
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/recommendations/posts",
	summary: "Fetch affinity cluster interest-graph post recommendation feed",
	tags: [recommendationTag],
	description:
		"Builds a targeted stream matching sub-relation upvote spaces where the requesting context has historically interacted. Fallback paths default straight back to highly active top-voted records.",
	request: {
		query: z.object({
			limit: z.string().optional().openapi({
				description: "Total suggested post records array allocation size",
				example: "5",
			}),
		}),
	},
	responses: {
		200: {
			description:
				"Returns an interest graph array payload collection of recommended post models.",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: z.array(feedPostItemSchema),
					}),
					example: {
						success: true,
						data: [
							{
								id: "e93dbb40-8f64-42b4-82ee-c1b1842814ff",
								title:
									"Why memory allocation matters in high throughput systems",
								content:
									"Deep diving stack management optimization mechanics inside raw backend nodes...",
								createdAt: "2026-07-17T12:00:00.000Z",
								deletedAt: null,
								isLocked: false,
								authorId: "u11d6cb4-4bf8-4682-8bc7-e316d29df11a",
								communityId: "d83dbb40-8f64-42b4-82ee-c1b1842813cc",
								user: { username: "systems_guru" },
								community: { name: "Rust Systems Dev", slug: "rust-systems" },
								_count: { comment: 32, votes: 147 },
							},
						],
					},
				},
			},
		},
	},
});

// HealthCheck
registry.registerPath({
	method: "get",
	path: "/health/live",
	summary: "Public runtime liveness probe check",
	tags: [healthTags],
	responses: {
		200: {
			description: "Runtime environment event loop is responsive",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/health",
	summary: "Basic application health diagnostics status",
	tags: [healthTags],
	security: [{ [bearerAuth.name]: [] }],
	responses: {
		200: {
			description:
				"Application system uptime diagnostics metrics returned successfully",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: HealthStatusSchema,
					}),
				},
			},
		},
		401: {
			description: "Unauthenticated access context missing token headers",
		},
		403: {
			description: "Forbidden: Request context missing Admin permissions",
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/health/ready",
	summary: "Deep dependency infrastructure readiness validation check",
	tags: [healthTags],
	security: [{ [bearerAuth.name]: [] }],
	responses: {
		200: {
			description: "All critical backing subsystems are responsive and online",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: DeepReadinessSchema,
					}),
				},
			},
		},
		503: {
			description:
				"One or more core network data services are currently degraded or unreachable",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						data: DeepReadinessSchema,
					}),
				},
			},
		},
	},
});

registry.registerPath({
	method: "get",
	path: "/metrics",
	summary: "Expose Prometheus raw tracking performance telemetry",
	tags: [healthTags],
	security: [{ [bearerAuth.name]: [] }],
	responses: {
		200: {
			description: "Plain text formatted OpenMetrics scraping pool dump",
			content: {
				"text/plain; version=0.0.4; charset=utf-8": {
					schema: z.string().openapi({
						example:
							"# HELP process_cpu_user_seconds_total Total user CPU time spent...",
					}),
				},
			},
		},
		401: { description: "Unauthenticated context" },
		403: { description: "Forbidden" },
	},
});

export const generateOpenApiDocs = () => {
	const generator = new OpenApiGeneratorV3(registry.definitions);
	return generator.generateDocument({
		openapi: "3.0.0",
		info: {
			title: "Forum API Engine",
			version: "1.0.0",
			description:
				"Zod-powered API Documentation mapping explicit internal parameters and payload data structures.",
		},
		servers: [{ url: "/api/v1" }],
	});
};
