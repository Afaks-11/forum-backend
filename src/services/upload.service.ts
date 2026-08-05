import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.config.js";

cloudinary.config({
	cloud_name: env.cloudinaryConfig.cloudName,
	api_key: env.cloudinaryConfig.apiKey,
	api_secret: env.cloudinaryConfig.apiSecret,
	secure: true,
});

/**
 * Signs a direct-to-Cloudinary upload so clients can upload without proxying
 * the file through this server or ever seeing the API secret.
 */
export const generateCloudinarySignature = (folder: string) => {
	// Cloudinary expects seconds, not milliseconds, and rejects signatures whose
	// timestamp drifts too far from its own clock.
	const timestamp = Math.round(Date.now() / 1000);

	// Only these parameters are signed, so the client cannot redirect the upload
	// to a different folder without invalidating the signature.
	const paramsToSign = {
		timestamp,
		folder,
	};

	const signature = cloudinary.utils.api_sign_request(
		paramsToSign,
		env.cloudinaryConfig.apiSecret,
	);

	return {
		timestamp,
		signature,
		cloudName: env.cloudinaryConfig.cloudName,
		apiKey: env.cloudinaryConfig.apiKey,
		folder,
	};
};
