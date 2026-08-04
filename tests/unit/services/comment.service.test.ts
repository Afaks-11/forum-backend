import { describe, expect, it, jest } from "@jest/globals";
import { AppError } from "../../../src/errors/AppError.js";

// Module Level Repository and Core Subsystem Mocks
const mockPostRepository = {
	findById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockCommentRepository = {
	create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findActiveById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findManyActiveByPostId: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateFields: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	softDelete: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateLockState: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	removeByModerator: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findSavedRelation: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	createSavedRelation: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	createCommentReport: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockEmit = jest.fn<(...args: unknown[]) => unknown>();
const mockTo = jest.fn<(...args: unknown[]) => unknown>();
const mockGetIO = jest.fn<(...args: unknown[]) => unknown>();

const mockLogger = {
	warn: jest.fn(),
};

const mockSendInternalNotification =
	jest.fn<(...args: unknown[]) => Promise<unknown>>();

// Isolate ES Modules prior to execution boundaries
await jest.unstable_mockModule("../../../src/repositories/index.js", () => ({
	postRepository: mockPostRepository,
	commentRepository: mockCommentRepository,
}));
await jest.unstable_mockModule("../../../src/socket/socket.server.js", () => ({
	getIO: mockGetIO,
}));
await jest.unstable_mockModule("../../../src/utils/logger.js", () => ({
	logger: mockLogger,
}));
await jest.unstable_mockModule(
	"../../../src/services/notification.service.js",
	() => ({
		sendInternalNotification: mockSendInternalNotification,
	}),
);

// Resolve targeted operations under testing
const {
	createComment,
	getPostComments,
	updateCommentFields,
	softDeleteComment,
	modifyCommentState,
} = await import("../../../src/services/comment.service.js");

const { createFakeComment, createFakePostPayload } = await import(
	"../../fixtures/comment.fixture.js"
);

describe("Comment Service Unit Test Suite", () => {
	describe("createComment", () => {
		it("Happy Path (Root Comment): should instantiate root comment, trigger internal notification, and broadcast via websocket", async () => {
			mockPostRepository.findById.mockReset();
			mockCommentRepository.create.mockReset();
			mockSendInternalNotification.mockReset();

			// Explicitly map socket implementation for this specific test block
			mockEmit.mockImplementation(() => {});
			mockTo.mockImplementation(() => ({ emit: mockEmit }));
			mockGetIO.mockImplementation(() => ({ to: mockTo }));

			mockGetIO.mockClear();
			mockTo.mockClear();
			mockEmit.mockClear();

			const input = {
				postId: "post_123",
				content: "Great architectural breakdown!",
			};
			const fakePost = createFakePostPayload({ authorId: "usr_owner" });
			const fakeComment = createFakeComment({ content: input.content });

			mockPostRepository.findById.mockResolvedValue(fakePost);
			mockCommentRepository.create.mockResolvedValue(fakeComment);

			const result = await createComment(input, "usr_123");

			expect(mockPostRepository.findById).toHaveBeenCalledWith("post_123");
			expect(mockCommentRepository.create).toHaveBeenCalledWith({
				content: input.content,
				postId: "post_123",
				authorId: "usr_123",
			});
			expect(mockSendInternalNotification).toHaveBeenCalledWith({
				recipientId: "usr_owner",
				senderId: "usr_123",
				type: "COMMENT",
				title: "New comment on your post",
				content: 'Someone commented: "Great architectural breakdown!..."',
				link: "/posts/post_123",
			});
			expect(mockGetIO).toHaveBeenCalled();
			expect(mockTo).toHaveBeenCalledWith("post:post_123");
			expect(mockEmit).toHaveBeenCalledWith("comment:new", fakeComment);
			expect(result).toEqual(fakeComment);
		});

		it("Happy Path (Reply Comment): should append parent relation parameters and direct notifications to thread author", async () => {
			mockCommentRepository.findActiveById.mockReset();
			mockCommentRepository.create.mockReset();
			mockSendInternalNotification.mockReset();

			// Explicitly map socket implementation for this specific test block
			mockEmit.mockImplementation(() => {});
			mockTo.mockImplementation(() => ({ emit: mockEmit }));
			mockGetIO.mockImplementation(() => ({ to: mockTo }));

			const input = {
				postId: "post_123",
				content: "Agreed with this point.",
				parentId: "cmnt_parent",
			};
			const fakePost = createFakePostPayload();
			const parentComment = createFakeComment({
				id: "cmnt_parent",
				authorId: "usr_parent",
			});
			const fakeReply = createFakeComment({
				content: input.content,
				parentId: "cmnt_parent",
			});

			mockPostRepository.findById.mockResolvedValue(fakePost);
			mockCommentRepository.findActiveById.mockResolvedValue(parentComment);
			mockCommentRepository.create.mockResolvedValue(fakeReply);

			const result = await createComment(input, "usr_123");

			expect(mockCommentRepository.findActiveById).toHaveBeenCalledWith(
				"cmnt_parent",
			);
			expect(mockCommentRepository.create).toHaveBeenCalledWith({
				content: input.content,
				postId: "post_123",
				authorId: "usr_123",
				parentId: "cmnt_parent",
			});
			expect(mockSendInternalNotification).toHaveBeenCalledWith({
				recipientId: "usr_parent",
				senderId: "usr_123",
				type: "REPLY",
				title: "New reply to your comment",
				content: 'Someone replied: "Agreed with this point...."',
				link: "/posts/post_123",
			});
			expect(result).toEqual(fakeReply);
		});

		it("Business Rule: should throw 404 AppError if the parent post target cannot be found", async () => {
			mockPostRepository.findById.mockReset();
			mockPostRepository.findById.mockResolvedValue(null);

			await expect(
				createComment({ postId: "missing_post", content: "Hello" }, "usr_123"),
			).rejects.toThrow(new AppError("Post not found", 404));
		});

		it("Business Rule: should throw 400 AppError if the target post is locked from moderation actions", async () => {
			mockPostRepository.findById.mockReset();
			mockPostRepository.findById.mockResolvedValue(
				createFakePostPayload({ isLocked: true }),
			);

			await expect(
				createComment({ postId: "post_123", content: "Hello" }, "usr_123"),
			).rejects.toThrow(
				new AppError("This posts's comment section is locked", 400),
			);
		});

		it("Business Rule: should throw 404 AppError if specified parent thread reply identifier does not match active records", async () => {
			mockPostRepository.findById.mockReset();
			mockCommentRepository.findActiveById.mockReset();

			mockPostRepository.findById.mockResolvedValue(createFakePostPayload());
			mockCommentRepository.findActiveById.mockResolvedValue(null);

			await expect(
				createComment(
					{ postId: "post_123", content: "Reply", parentId: "missing_parent" },
					"usr_123",
				),
			).rejects.toThrow(new AppError("Parent comment not found", 404));
		});

		it("Business Rule: should throw 400 AppError if parent comment node has been locked by system operators", async () => {
			mockPostRepository.findById.mockReset();
			mockCommentRepository.findActiveById.mockReset();

			mockPostRepository.findById.mockResolvedValue(createFakePostPayload());
			mockCommentRepository.findActiveById.mockResolvedValue(
				createFakeComment({ isLocked: true }),
			);

			await expect(
				createComment(
					{ postId: "post_123", content: "Reply", parentId: "cmnt_locked" },
					"usr_123",
				),
			).rejects.toThrow(
				new AppError("This comment thread is locked for replies", 400),
			);
		});

		it("Edge Case: should catch connection drops gracefully via logging subsystem if socket engine is offline", async () => {
			mockPostRepository.findById.mockReset();
			mockCommentRepository.create.mockReset();
			mockLogger.warn.mockReset();

			const input = { postId: "post_123", content: "Resilient write path" };
			mockPostRepository.findById.mockResolvedValue(createFakePostPayload());
			mockCommentRepository.create.mockResolvedValue(createFakeComment());

			// Explicitly force socket layer failures for offline runtime paths
			mockGetIO.mockImplementation(() => {
				throw new Error("Socket cluster unreachable");
			});

			const result = await createComment(input, "usr_123");

			expect(mockLogger.warn).toHaveBeenCalledWith(
				"[Live Comments] Socket server offline; falling back to DB storage only.",
			);
			expect(result).toBeDefined();
		});
	});

	describe("getPostComments", () => {
		it("Happy Path: should retrieve chronologically ordered active records tied to a target post identification footprint", async () => {
			mockCommentRepository.findManyActiveByPostId.mockReset();
			const outputBuffer = [
				createFakeComment(),
				createFakeComment({ id: "cmnt_790" }),
			];
			mockCommentRepository.findManyActiveByPostId.mockResolvedValue(
				outputBuffer,
			);

			const result = await getPostComments("post_123");

			expect(mockCommentRepository.findManyActiveByPostId).toHaveBeenCalledWith(
				"post_123",
			);
			expect(result).toEqual(outputBuffer);
		});
	});

	describe("updateCommentFields", () => {
		it("Happy Path: should commit textual payload updates if sender is authorized as record designer", async () => {
			mockCommentRepository.findById.mockReset();
			mockCommentRepository.updateFields.mockReset();

			const liveComment = createFakeComment({ authorId: "usr_owner" });
			mockCommentRepository.findById.mockResolvedValue(liveComment);
			mockCommentRepository.updateFields.mockResolvedValue({
				...liveComment,
				content: "Mutated Content",
				isEdited: true,
			});

			const result = await updateCommentFields(
				"cmnt_789",
				"usr_owner",
				"Mutated Content",
			);

			expect(mockCommentRepository.updateFields).toHaveBeenCalledWith(
				"cmnt_789",
				"Mutated Content",
			);
			expect(result.content).toBe("Mutated Content");
		});

		it("Business Rule (Not Found): should raise 404 AppError if target node has a filled deletedAt field value", async () => {
			mockCommentRepository.findById.mockReset();
			mockCommentRepository.findById.mockResolvedValue(
				createFakeComment({ deletedAt: new Date() }),
			);

			await expect(
				updateCommentFields("cmnt_789", "usr_owner", "New text"),
			).rejects.toThrow(new AppError("Comment not found", 404));
		});

		it("Business Rule (Forbidden): should intercept execution with 403 AppError if sender credentials clash with record registration", async () => {
			mockCommentRepository.findById.mockReset();
			mockCommentRepository.findById.mockResolvedValue(
				createFakeComment({ authorId: "usr_owner" }),
			);

			await expect(
				updateCommentFields("cmnt_789", "usr_imposter", "New text"),
			).rejects.toThrow(new AppError("Forbidden: You are not the author", 403));
		});
	});

	describe("softDeleteComment", () => {
		it("Happy Path: should assert author ownership before updating target lifecycle fields via repository wrappers", async () => {
			mockCommentRepository.findById.mockReset();
			mockCommentRepository.softDelete.mockReset();

			mockCommentRepository.findById.mockResolvedValue(
				createFakeComment({ authorId: "usr_owner" }),
			);
			mockCommentRepository.softDelete.mockResolvedValue({
				id: "cmnt_789",
				deletedAt: new Date(),
			});

			await softDeleteComment("cmnt_789", "usr_owner");

			expect(mockCommentRepository.softDelete).toHaveBeenCalledWith("cmnt_789");
		});

		it("Business Rule (Unauthorized): should guard lifecycle deletion fields with a 403 ownership response", async () => {
			mockCommentRepository.findById.mockReset();
			mockCommentRepository.findById.mockResolvedValue(
				createFakeComment({ authorId: "usr_owner" }),
			);

			await expect(
				softDeleteComment("cmnt_789", "usr_intruder"),
			).rejects.toThrow(
				new AppError("Forbidden: You do not own this comment", 403),
			);
		});
	});

	describe("modifyCommentState", () => {
		it("Business Rule (Global Check): should confirm the operational target exists before sorting action operations", async () => {
			mockCommentRepository.findById.mockReset();
			mockCommentRepository.findById.mockResolvedValue(null);

			await expect(
				modifyCommentState("missing_id", "usr_mod", "LOCK"),
			).rejects.toThrow(new AppError("Comment not found", 404));
		});

		describe("Action: LOCK", () => {
			it("Happy Path: should flip structural access permissions on targeted comment nodes using an inverted state logic", async () => {
				mockCommentRepository.findById.mockReset();
				mockCommentRepository.updateLockState.mockReset();

				mockCommentRepository.findById.mockResolvedValue(
					createFakeComment({ isLocked: false }),
				);

				const response = await modifyCommentState(
					"cmnt_789",
					"usr_mod",
					"LOCK",
				);

				expect(mockCommentRepository.updateLockState).toHaveBeenCalledWith(
					"cmnt_789",
					true,
				);
				expect(response).toEqual({ success: true });
			});
		});

		describe("Action: REMOVE", () => {
			it("Happy Path: should erase sensitive workspace details and forward structural warnings to affected user streams", async () => {
				mockCommentRepository.findById.mockReset();
				mockCommentRepository.removeByModerator.mockReset();
				mockSendInternalNotification.mockReset();

				mockCommentRepository.findById.mockResolvedValue(
					createFakeComment({ authorId: "usr_author", postId: "post_123" }),
				);

				const response = await modifyCommentState(
					"cmnt_789",
					"usr_mod",
					"REMOVE",
					"Inappropriate language",
				);

				expect(mockCommentRepository.removeByModerator).toHaveBeenCalledWith(
					"cmnt_789",
				);
				expect(mockSendInternalNotification).toHaveBeenCalledWith({
					recipientId: "usr_author",
					senderId: "usr_mod",
					type: "MOD_ACTION",
					title: "Comment removed by moderation guidelines",
					content:
						"Your comment was removed for violating community code standards. Reason: Inappropriate language",
					link: "/posts/post_123",
				});
				expect(response).toEqual({ success: true });
			});

			it("Edge Case: should inject predictable defaults if a moderation override occurs without a text reason statement", async () => {
				mockCommentRepository.findById.mockReset();
				mockSendInternalNotification.mockReset();

				mockCommentRepository.findById.mockResolvedValue(
					createFakeComment({ authorId: "usr_author", postId: "post_123" }),
				);

				await modifyCommentState("cmnt_789", "usr_mod", "REMOVE");

				expect(mockSendInternalNotification).toHaveBeenCalledWith(
					expect.objectContaining({
						content:
							"Your comment was removed for violating community code standards. Reason: None specified",
					}),
				);
			});
		});

		describe("Action: REPORT", () => {
			it("Happy Path: should process and structure inbound user dispute tickets via internal compliance structures", async () => {
				mockCommentRepository.findById.mockReset();
				mockCommentRepository.createCommentReport.mockReset();

				mockCommentRepository.findById.mockResolvedValue(createFakeComment());

				const response = await modifyCommentState(
					"cmnt_789",
					"usr_reporter",
					"REPORT",
					"Harassment",
				);

				expect(mockCommentRepository.createCommentReport).toHaveBeenCalledWith({
					commentId: "cmnt_789",
					reporterId: "usr_reporter",
					reason: "Harassment",
				});
				expect(response).toEqual({ success: true });
			});

			it("Edge Case: should populate boilerplate metadata when user claims are submitted without explanation arrays", async () => {
				mockCommentRepository.findById.mockReset();
				mockCommentRepository.createCommentReport.mockReset();

				mockCommentRepository.findById.mockResolvedValue(createFakeComment());

				await modifyCommentState("cmnt_789", "usr_reporter", "REPORT");

				expect(mockCommentRepository.createCommentReport).toHaveBeenCalledWith({
					commentId: "cmnt_789",
					reporterId: "usr_reporter",
					reason: "Violated community standards guidelines.",
				});
			});
		});

		describe("Action: SAVE", () => {
			it("Happy Path (New Bookmark): should record relationship pairings if data arrays return unlinked records", async () => {
				mockCommentRepository.findById.mockReset();
				mockCommentRepository.findSavedRelation.mockReset();
				mockCommentRepository.createSavedRelation.mockReset();

				mockCommentRepository.findById.mockResolvedValue(createFakeComment());
				mockCommentRepository.findSavedRelation.mockResolvedValue(null);

				const response = await modifyCommentState(
					"cmnt_789",
					"usr_123",
					"SAVE",
				);

				expect(mockCommentRepository.findSavedRelation).toHaveBeenCalledWith(
					"usr_123",
					"cmnt_789",
				);
				expect(mockCommentRepository.createSavedRelation).toHaveBeenCalledWith(
					"usr_123",
					"cmnt_789",
				);
				expect(response).toEqual({ success: true });
			});

			it("Happy Path (Duplicate Bookmark): should short-circuit smoothly without duplicating relational rows", async () => {
				mockCommentRepository.findById.mockReset();
				mockCommentRepository.findSavedRelation.mockReset();
				mockCommentRepository.createSavedRelation.mockReset();

				mockCommentRepository.findById.mockResolvedValue(createFakeComment());
				mockCommentRepository.findSavedRelation.mockResolvedValue({
					userId: "usr_123",
					commentId: "cmnt_789",
				});

				const response = await modifyCommentState(
					"cmnt_789",
					"usr_123",
					"SAVE",
				);

				expect(
					mockCommentRepository.createSavedRelation,
				).not.toHaveBeenCalled();
				expect(response).toEqual({ success: true });
			});
		});
	});
});
