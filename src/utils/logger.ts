import pino from "pino";
import { env } from "../config/env.config.js";

const isDevelopment = env.app.nodeEnv === "development";

const loggerOptions: pino.LoggerOptions = {
	level: isDevelopment ? "debug" : "info",
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: {
		level: (label) => ({ level: label.toUpperCase() }),
	},
};

if (isDevelopment) {
	loggerOptions.transport = {
		target: "pino-pretty",
		options: {
			colorize: true,
			ignore: "pid,hostname",
			translateTime: "SYS:standard",
		},
	};
}

export const logger = pino(loggerOptions);
