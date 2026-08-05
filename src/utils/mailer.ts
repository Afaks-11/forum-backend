import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.config.js";
import { logger } from "./logger.js";

let transporter: Transporter | undefined;

// The transporter is created lazily and memoized: verify() opens a real SMTP
// handshake, so building one per email would add a round trip to every send.
const initMailer = async (): Promise<Transporter> => {
	if (transporter) {
		return transporter;
	}

	transporter = nodemailer.createTransport({
		service: "gmail",
		auth: {
			user: env.smtp.smtp_user,
			pass: env.smtp.smtp_pass,
		},
	});

	await transporter.verify();
	logger.info("SMTP connection established.");

	return transporter;
};

/**
 * Sends a transactional email.
 * Delivery failures are logged but never thrown: callers run inside queue
 * workers where an unhandled rejection would fail the whole job.
 */
export const sendSystemEmail = async (
	to: string,
	subject: string,
	htmlContent: string,
): Promise<void> => {
	try {
		const mailClient = await initMailer();

		const info = await mailClient.sendMail({
			from: env.smtp.smtp_from,
			to,
			subject,
			html: htmlContent,
		});

		logger.info(
			{ messagedId: info.messagedId, recipient: to },
			"Email sent successfully.",
		);
	} catch (error) {
		logger.error({ err: error }, "Critical: Failed to deliver email alert:");
	}
};
