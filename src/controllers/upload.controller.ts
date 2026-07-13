import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { generateCloudinarySignature } from "../services/upload.service.js";

const signatureQuerySchema = z.object({
	folder: z.enum(["avatars", "banners", "posts"]),
});

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
