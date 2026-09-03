import "dotenv/config";
import { faker } from "@faker-js/faker";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";
import pg from "pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
	throw new Error("DATABASE_URL is required to seed the database");

faker.seed(20260827);

const pool = new pg.Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const seed = async () => {
	const password = await bcrypt.hash("ForumDemo123!", 10);
	const users = await Promise.all(
		Array.from({ length: 8 }, (_, index) =>
			prisma.user.upsert({
				where: { email: `demo${index + 1}@forum.local` },
				update: {},
				create: {
					username: `demo_user_${index + 1}`,
					email: `demo${index + 1}@forum.local`,
					password,
					role: index === 0 ? "ADMIN" : "USER",
					isEmailVerified: true,
				},
			}),
		),
	);

	const admin = users[0];
	if (!admin) throw new Error("Seed user creation failed");

	const community = await prisma.community.upsert({
		where: { slug: "backend-engineering" },
		update: {},
		create: {
			name: "Backend Engineering",
			slug: "backend-engineering",
			description: "A seeded community for backend architecture discussions.",
			creatorId: admin.id,
		},
	});

	await Promise.all(
		users.map((user, index) =>
			prisma.membership.upsert({
				where: {
					userId_communityId: {
						userId: user.id,
						communityId: community.id,
					},
				},
				update: {},
				create: {
					userId: user.id,
					communityId: community.id,
					role: index === 0 ? "MODERATOR" : "MEMBER",
				},
			}),
		),
	);

	const existingPosts = await prisma.post.count({
		where: { communityId: community.id },
	});
	if (existingPosts === 0) {
		const posts = await Promise.all(
			Array.from({ length: 20 }, (_, index) => {
				const author = users[index % users.length];
				if (!author) throw new Error("Seed author missing");
				return prisma.post.create({
					data: {
						title: faker.hacker.phrase().slice(0, 100),
						content: faker.lorem.paragraphs(2),
						authorId: author.id,
						communityId: community.id,
					},
				});
			}),
		);

		await Promise.all(
			posts.map(async (post, postIndex) => {
				const voters = users.slice(0, (postIndex % users.length) + 1);
				const type = postIndex % 5 === 0 ? "DOWNVOTE" : "UPVOTE";
				await Promise.all(
					voters.map((user) =>
						prisma.vote.create({
							data: { userId: user.id, postId: post.id, type },
						}),
					),
				);

				const upvoteCount = type === "UPVOTE" ? voters.length : 0;
				const downvoteCount = type === "DOWNVOTE" ? voters.length : 0;
				await prisma.post.update({
					where: { id: post.id },
					data: {
						upvoteCount,
						downvoteCount,
						score: upvoteCount - downvoteCount,
					},
				});
			}),
		);
	}
};

try {
	await seed();
} finally {
	await prisma.$disconnect();
	await pool.end();
}
