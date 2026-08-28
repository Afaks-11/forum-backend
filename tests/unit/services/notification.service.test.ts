import { describe, expect, it, jest } from "@jest/globals";
import { AppError } from "../../../src/errors/AppError.js";

// Module Level Infrastructure Mocks typed safely using 'unknown'
const mockNotificationRepository = {
	findAllByRecipientId: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findUnreadByRecipientId: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	findById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateReadStatus: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	updateManyReadStatusByRecipient:
		jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	delete: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
	countUnreadByRecipientId: jest.fn<(...args: unknown[]) => Promise<number>>(),
};

const mockNotificationQueue = {
	add: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};
const mockGetTraceId = jest.fn<() => string | undefined>();

// Isolate ES Modules prior to test environment execution
await jest.unstable_mockModule("../../../src/repositories/index.js", () => ({
	notificationRepository: mockNotificationRepository,
}));
await jest.unstable_mockModule(
	"../../../src/queues/notification.queue.js",
	() => ({
		notificationQueue: mockNotificationQueue,
	}),
);
await jest.unstable_mockModule("../../../src/utils/requestContext.js", () => ({
	getTraceId: mockGetTraceId,
}));

// Resolve targeted operations under testing
const {
	getAllNotifications,
	getUnreadNotifications,
	markNotificationAsRead,
	markAllNotificationsAsRead,
	deleteNotification,
	sendInternalNotification,
} = await import("../../../src/services/notification.service.js");

describe("Notification Service Unit Test Suite", () => {
	describe("getAllNotifications", () => {
		it("should retrieve all notifications tied to a target user identification footprint", async () => {
			mockNotificationRepository.findAllByRecipientId.mockReset();

			const databaseBuffer = [
				{ id: "ntf_1", recipientId: "usr_123", title: "Alert One" },
				{ id: "ntf_2", recipientId: "usr_123", title: "Alert Two" },
			];
			mockNotificationRepository.findAllByRecipientId.mockResolvedValue({
				items: databaseBuffer,
				nextCursor: null,
			});

			const result = await getAllNotifications("usr_123", { limit: 20 });

			expect(
				mockNotificationRepository.findAllByRecipientId,
			).toHaveBeenCalledWith("usr_123", 20, undefined);
			expect(result).toEqual({ items: databaseBuffer, nextCursor: null });
		});
	});

	describe("getUnreadNotifications", () => {
		it("should extract only unread filtered data elements from database queries", async () => {
			mockNotificationRepository.findUnreadByRecipientId.mockReset();

			const databaseBuffer = [
				{ id: "ntf_1", recipientId: "usr_123", isRead: false },
			];
			mockNotificationRepository.findUnreadByRecipientId.mockResolvedValue({
				items: databaseBuffer,
				nextCursor: null,
			});

			const result = await getUnreadNotifications("usr_123", { limit: 20 });

			expect(
				mockNotificationRepository.findUnreadByRecipientId,
			).toHaveBeenCalledWith("usr_123", 20, undefined);
			expect(result).toEqual({ items: databaseBuffer, nextCursor: null });
		});
	});

	describe("markNotificationAsRead", () => {
		it("Happy Path: should commit status modifications if execution footprints match identity records", async () => {
			mockNotificationRepository.findById.mockReset();
			mockNotificationRepository.updateReadStatus.mockReset();

			const targetRecord = {
				id: "ntf_99",
				recipientId: "usr_123",
				isRead: false,
			};
			mockNotificationRepository.findById.mockResolvedValue(targetRecord);
			mockNotificationRepository.updateReadStatus.mockResolvedValue({
				...targetRecord,
				isRead: true,
			});

			const result = await markNotificationAsRead("ntf_99", "usr_123");

			expect(mockNotificationRepository.findById).toHaveBeenCalledWith(
				"ntf_99",
			);
			expect(mockNotificationRepository.updateReadStatus).toHaveBeenCalledWith(
				"ntf_99",
				true,
			);
			expect(result).toEqual({
				id: "ntf_99",
				recipientId: "usr_123",
				isRead: true,
			});
		});

		it("Business Rule (Not Found): should raise 404 AppError if target element reference is missing", async () => {
			mockNotificationRepository.findById.mockReset();
			mockNotificationRepository.findById.mockResolvedValue(null);

			await expect(
				markNotificationAsRead("missing_ntf", "usr_123"),
			).rejects.toThrow(new AppError("Notification target not found", 404));
		});

		it("Business Rule (Forbidden): should guard execution paths with a 403 response on user discrepancies", async () => {
			mockNotificationRepository.findById.mockReset();

			const lockedRecord = {
				id: "ntf_99",
				recipientId: "usr_owner",
				isRead: false,
			};
			mockNotificationRepository.findById.mockResolvedValue(lockedRecord);

			await expect(
				markNotificationAsRead("ntf_99", "usr_imposter"),
			).rejects.toThrow(new AppError("Forbidden adjustment action", 403));
		});
	});

	describe("markAllNotificationsAsRead", () => {
		it("should commit bulk state updates to active recipient indices directly", async () => {
			mockNotificationRepository.updateManyReadStatusByRecipient.mockReset();
			mockNotificationRepository.updateManyReadStatusByRecipient.mockResolvedValue(
				{ count: 5 },
			);

			const result = await markAllNotificationsAsRead("usr_123");

			expect(
				mockNotificationRepository.updateManyReadStatusByRecipient,
			).toHaveBeenCalledWith("usr_123", true);
			expect(result).toEqual({ count: 5 });
		});
	});

	describe("deleteNotification", () => {
		it("Happy Path: should complete raw hard erasures if identity criteria checks validate successfully", async () => {
			mockNotificationRepository.findById.mockReset();
			mockNotificationRepository.delete.mockReset();

			const targetedRecord = { id: "ntf_88", recipientId: "usr_123" };
			mockNotificationRepository.findById.mockResolvedValue(targetedRecord);
			mockNotificationRepository.delete.mockResolvedValue({
				id: "ntf_88",
				success: true,
			});

			const result = await deleteNotification("ntf_88", "usr_123");

			expect(mockNotificationRepository.findById).toHaveBeenCalledWith(
				"ntf_88",
			);
			expect(mockNotificationRepository.delete).toHaveBeenCalledWith("ntf_88");
			expect(result).toEqual({ id: "ntf_88", success: true });
		});

		it("Business Rule (Not Found): should throw 404 AppError if delete target record is missing", async () => {
			mockNotificationRepository.findById.mockReset();
			mockNotificationRepository.findById.mockResolvedValue(null);

			await expect(
				deleteNotification("missing_ntf", "usr_123"),
			).rejects.toThrow(new AppError("Notification not found", 404));
		});

		it("Business Rule (Forbidden): should prevent structural deletion commands if identity claims clash", async () => {
			mockNotificationRepository.findById.mockReset();

			const lockedRecord = { id: "ntf_88", recipientId: "usr_owner" };
			mockNotificationRepository.findById.mockResolvedValue(lockedRecord);

			await expect(
				deleteNotification("ntf_88", "usr_imposter"),
			).rejects.toThrow(new AppError("Forbidden action", 403));
		});
	});

	describe("sendInternalNotification", () => {
		it("Edge Case (Self-Alert Suppression): should return null and bypass worker queues when users trigger things on themselves", async () => {
			mockNotificationQueue.add.mockReset();

			const inputPayload = {
				recipientId: "usr_shared_id",
				senderId: "usr_shared_id",
				type: "COMMENT" as const,
				title: "Loopback Event Flag",
				content: "Self action notification bypass test loop.",
			};

			const result = await sendInternalNotification(inputPayload);

			expect(mockNotificationQueue.add).not.toHaveBeenCalled();
			expect(result).toBeNull();
		});

		it("Happy Path: should dispatch valid notification data payloads out into active worker queues", async () => {
			mockNotificationQueue.add.mockReset();
			mockGetTraceId.mockReturnValue(undefined);

			const inputPayload = {
				recipientId: "usr_recipient",
				senderId: "usr_sender",
				type: "REPLY" as const,
				dedupeKey: "reply-123",
				title: "New reply notification alert",
				content: "Someone replied to your comment thread.",
				link: "/posts/123",
			};

			mockNotificationQueue.add.mockResolvedValue({ id: "job_999" });

			const result = await sendInternalNotification(inputPayload);

			expect(mockNotificationQueue.add).toHaveBeenCalledWith(
				"notification:recipient:usr_recipient",
				inputPayload,
				expect.objectContaining({ jobId: expect.any(String) }),
			);
			expect(result).toEqual({ id: "job_999" });
		});

		it("Reliability: should log and swallow a queue outage after the originating write committed", async () => {
			mockNotificationQueue.add.mockRejectedValue(
				new Error("Redis unavailable"),
			);
			mockGetTraceId.mockReturnValue("trace-123");

			await expect(
				sendInternalNotification({
					recipientId: "usr_recipient",
					senderId: "usr_sender",
					type: "COMMENT",
					dedupeKey: "comment-1",
					title: "New comment",
					content: "A committed comment",
				}),
			).resolves.toBeNull();
		});
	});
});
