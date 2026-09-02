import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";

import { env } from "./config/env.config.js";

import { generateOpenApiDocs } from "./docs/swaggerRegistry.js";

import { globalErrorHandler } from "./middlewares/errorHandler.js";
import { loggingMiddleware } from "./middlewares/logging.middleware.js";
import { metricsMiddleware } from "./middlewares/metrics.middleware.js";
import { queueAuthMiddleware } from "./middlewares/queueAuth.middleware.js";
import { limiter } from "./middlewares/rateLimit.middleware.js";
import { traceMiddleware } from "./middlewares/trace.middleware.js";

import { getQueueDashboardAdapter } from "./queues/dashboard.js";

import authRouter from "./routes/auth.routes.js";
import commentRouter from "./routes/comment.routes.js";
import communityRouter from "./routes/community.routes.js";
import feedRouter from "./routes/feed.routes.js";
import healthRouter from "./routes/health.routes.js";
import metricRouter from "./routes/metrics.routes.js";
import notificationRouter from "./routes/notification.routes.js";
import postRouter from "./routes/post.routes.js";
import recommendationRouter from "./routes/recommendation.routes.js";
import reportRouter from "./routes/report.routes.js";
import uploadRouter from "./routes/upload.routes.js";
import userRouter from "./routes/user.routes.js";
import voteRouter from "./routes/vote.routes.js";

const app = express();
const openApiDocumentation = generateOpenApiDocs();

// Express must be told how many proxy hops to trust before `req.ip` reflects the
// real client. Left unset, every request behind a load balancer reports the
// proxy's address, so the per-IP rate limiter meters all users as one bucket.
app.set("trust proxy", env.app.trustProxyHops);

const allowedOrigins = env.app.corsOrigins;

app.use(
	cors({
		origin: (origin, callback) => {
			if (!origin || allowedOrigins.includes(origin)) {
				return callback(null, true);
			}
			return callback(new Error("Not allowed by CORS"));
		},
		credentials: true,
	}),
);

app.use(
	helmet({
		// CSP is disabled because Swagger UI and bull-board inject inline scripts
		// that would otherwise be blocked, and defining a strict policy for every
		// third-party dashboard would couple the backend to their internal bundling.
		contentSecurityPolicy: false,
	}),
);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use(traceMiddleware);
app.use(loggingMiddleware);
app.use(metricsMiddleware);
app.use(limiter);

app.use("/health", healthRouter);
app.use("/metrics", metricRouter);

app.use(
	"/admin/queues",
	queueAuthMiddleware,
	getQueueDashboardAdapter().getRouter(),
);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocumentation));

app.get("/", (_req, res) => {
	res.send("Hello World");
});

const api = express.Router();

api.use("/auth", authRouter);
api.use("/communities", communityRouter);
api.use("/posts", postRouter);
api.use("/comments", commentRouter);
api.use("/votes", voteRouter);
api.use("/users", userRouter);
api.use("/notifications", notificationRouter);
api.use("/recommendations", recommendationRouter);
api.use("/reports", reportRouter);
api.use("/feed", feedRouter);
api.use("/upload", uploadRouter);

app.use("/api/v1", api);

app.use((_req, res) => {
	res.status(404).json({
		success: false,
		message: "Route not found",
	});
});

app.use(globalErrorHandler);

export default app;
