import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | undefined;

const initMailer = async (): Promise<Transporter> => {
	if (transporter) {
		return transporter;
	}

	const testAccount = await nodemailer.createTestAccount();

	transporter = nodemailer.createTransport({
		host: "smtp.ethereal.email",
		port: 587,
		secure: false,
		auth: {
			user: testAccount.user,
			pass: testAccount.pass,
		},
	});

	return transporter;
};

export const sendSystemEmail = async (
	to: string,
	subject: string,
	htmlContent: string,
): Promise<void> => {
	try {
		const mailClient = await initMailer();

		const info = await mailClient.sendMail({
			from: '"Forum Platform Security" <security@forumapp.com>',
			to,
			subject,
			html: htmlContent,
		});

		console.log(
			`Email sent! Preview URL: ${nodemailer.getTestMessageUrl(info)}`,
		);
	} catch (error) {
		console.error("Critical: Failed to deliver email alert:", error);
	}
};
