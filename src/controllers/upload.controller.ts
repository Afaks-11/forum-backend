import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { generateCloudinarySignature } from "../services/upload.service.js";

// The folder is constrained to a fixed set rather than accepted verbatim: the
// signature authorises whatever path it is issued for, so a free-form value
// would let a client write anywhere in the Cloudinary account.
const signatureQuerySchema = z.object({
	folder: z.enum(["avatars", "banners", "posts"]),
});

/**
 * Issues a short-lived Cloudinary signature so clients upload straight to
 * Cloudinary instead of streaming file bytes through this API.
 */
export const getUploadSignature = asyncHandler(
	async (req: Request, res: Response) => {
		const parseResult = signatureQuerySchema.safeParse(req.query);

		if (!parseResult.success) {
			throw new AppError(
				"Invalid folder target. Must be 'avatars', 'banners', or 'posts'.",
				400,
			);
		}

		const authData = generateCloudinarySignature(parseResult.data.folder);

		res.status(200).json({ success: true, data: authData });
	},
);
