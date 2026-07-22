import "dotenv/config";
import { createServer } from "node:http";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { generateOpenApiDocs } from "./docs/swaggerRegistry.js";
import { globalErrorHandler } from "./middlewares/errorHandler.js";
import { loggingMiddleware } from "./middlewares/logging.middleware.js";
import { metricsMiddleware } from "./middlewares/metrics.middleware.js";
import { limiter } from "./middlewares/rateLimit.middleware.js";
import { traceMiddleware } from "./middlewares/trace.middleware.js";
import "./workers/email.worker.js";
import "./workers/notification.worker.js";
import "./workers/cron.worker.js";
import "./workers/ranking.worker.js";
import { env } from "./config/env.config.js";
import { queueAuthMiddleware } from "./middlewares/queueAuth.middleware.js";
import { initScheduledJobs } from "./queues/cron.queue.js";
import { queueDashboardAdapter } from "./queues/dashboard.js";
import authRouter from "./routes/auth.routes.js";
import commentRouter from "./routes/comment.routes.js";
import communityRouter from "./routes/community.routes.js";
import healthRouter from "./routes/health.routes.js";
import metricRouter from "./routes/metrics.routes.js";
import notificationRouter from "./routes/notification.routes.js";
import postRouter from "./routes/post.routes.js";
import recommendationRouter from "./routes/recommendation.routes.js";
import userRouter from "./routes/user.routes.js";
import voteRouter from "./routes/vote.routes.js";
import { initSocketServer } from "./socket/socket.server.js";
import { logger } from "./utils/logger.js";

const PORT: number = env.app.port;
const app = express();
const httpServer = createServer(app);
const openApiDocumentation = generateOpenApiDocs();

app.use(cors({ origin: "*" }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use(traceMiddleware);
app.use(metricsMiddleware);
app.use(loggingMiddleware);
app.use(limiter);

app.use("/health", healthRouter);
app.use("/metrics", metricRouter);

app.use(
	"/admin/queues",
	queueAuthMiddleware,
	queueDashboardAdapter.getRouter(),
);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocumentation));

app.get("/", (_req: Request, res: Response, _next: NextFunction) => {
	res.send("Hello world");
});
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/communities", communityRouter);
app.use("/api/v1/posts", postRouter);
app.use("/api/v1/comments", commentRouter);
app.use("/api/v1/votes", voteRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/recommendations", recommendationRouter);

app.use(globalErrorHandler);

httpServer.listen(PORT, async () => {
	logger.info(`Server is running on http://localhost:${PORT}`);
	logger.info(
		`Swagger documentation live at http://localhost:${PORT}/api-docs`,
	);

	initSocketServer(httpServer);
	logger.info(`Real-time Socket.IO server engine initiated successfully!`);

	try {
		await initScheduledJobs();
		logger.info(
			" Repeatable background scheduled jobs successfully initialized!",
		);
	} catch (error) {
		logger.error(
			{ err: error },
			"Background task scheduler initialization failed:",
		);
	}
});
