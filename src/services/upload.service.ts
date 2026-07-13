import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.config.js";

cloudinary.config({
	cloud_name: env.cloudinaryConfig.cloudName,
	api_key: env.cloudinaryConfig.apiKey,
	api_secret: env.cloudinaryConfig.apiSecret,
	secure: true,
});

export const generateCloudinarySignature = (folder: string) => {
	const timestamp = Math.round(Date.now() / 1000);

	// You can lock down the upload by specifying a folder or transformations here
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
