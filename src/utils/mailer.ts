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
 * Reduces an address to `a***@example.com` for logging.
 *
 * Recipient addresses are PII and end up in whatever aggregates the logs; the
 * domain and first character are enough to debug a delivery problem.
 */
export const maskEmail = (address: string): string => {
	const separator = address.lastIndexOf("@");
	if (separator <= 0) return "***";

	const local = address.slice(0, separator);
	const domain = address.slice(separator);
	return `${local.slice(0, 1)}***${domain}`;
};

/**
 * Sends a transactional email, throwing when delivery fails.
 *
 * Swallowing SMTP errors here (the previous behaviour) reported every
 * undeliverable password-reset mail as a completed job, which made BullMQ's
 * three configured retries unreachable and inflated the `completed` metric with
 * mail that never left the building. Rejecting instead lets transient blips
 * genuinely retry and lands permanent failures in the retained failed set,
 * where Bull Board can surface them.
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
			{ messageId: info.messageId, recipient: maskEmail(to) },
			"Email sent successfully.",
		);
	} catch (error) {
		logger.error(
			{ err: error, recipient: maskEmail(to) },
			"Failed to deliver email; the job will be retried.",
		);
		throw error;
	}
};
