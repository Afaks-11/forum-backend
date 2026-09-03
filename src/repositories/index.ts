import { prisma } from "../utils/prisma.js";
import { CommentRepository } from "./comment.repository.js";
import { CommunityRepository } from "./community.repository.js";
import { CommunityInvitationRepository } from "./communityInvitation.repository.js";
import { NotificationRepository } from "./notification.repository.js";
import { PostRepository } from "./post.repository.js";
import { RecommendationRepository } from "./recommendation.repository.js";
import { ReportRepository } from "./report.repository.js";
import { TokenBlacklistRepository } from "./tokenBlacklist.repository.js";
import { UserRepository } from "./user.repository.js";
import { VoteRepository } from "./vote.repository.js";

// Single composition root for the data layer: every repository is instantiated
// once against the shared Prisma client, so services import ready singletons and
// never construct their own client. Unit tests mock this module wholesale.
export const postRepository = new PostRepository(prisma);
export const communityRepository = new CommunityRepository(prisma);
export const communityInvitationRepository = new CommunityInvitationRepository(
	prisma,
);
export const reportRepository = new ReportRepository(prisma);
export const userRepository = new UserRepository(prisma);
export const commentRepository = new CommentRepository(prisma);
export const notificationRepository = new NotificationRepository(prisma);
export const voteRepository = new VoteRepository(prisma);
export const tokenBlacklistRepository = new TokenBlacklistRepository();
export const recommendationRepository = new RecommendationRepository(prisma);
