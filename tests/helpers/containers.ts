import {
	PostgreSqlContainer,
	type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
	RedisContainer,
	type StartedRedisContainer,
} from "@testcontainers/redis";

export interface ContainerClusterInfo {
	databaseUrl: string;
	redisUrl: string;
}

export class TestContainerOrchestrator {
	private static instance: TestContainerOrchestrator | null = null;
	private postgresContainer: StartedPostgreSqlContainer | null = null;
	private redisContainer: StartedRedisContainer | null = null;
	private isInitializing = false;

	private constructor() {}

	/**
	 * Retrieves the singleton instance of the orchestrator.
	 */
	public static getInstance(): TestContainerOrchestrator {
		if (!TestContainerOrchestrator.instance) {
			TestContainerOrchestrator.instance = new TestContainerOrchestrator();
		}
		return TestContainerOrchestrator.instance;
	}

	/**
	 * Boots both PostgreSQL and Redis containers concurrently and returns connection URIs.
	 */
	public async startCluster(): Promise<ContainerClusterInfo> {
		if (this.postgresContainer && this.redisContainer) {
			return this.getClusterInfo();
		}

		if (this.isInitializing) {
			throw new Error(
				"Container cluster is already in the process of spinning up.",
			);
		}

		this.isInitializing = true;

		try {
			// Pulling and starting instances concurrently to optimize execution time
			const [startedPostgres, startedRedis] = await Promise.all([
				new PostgreSqlContainer("postgres:16-alpine")
					.withDatabase("portfolio_test")
					.withUsername("test_user")
					.withPassword("test_password")
					.start(),
				new RedisContainer("redis:7-alpine").start(),
			]);

			this.postgresContainer = startedPostgres;
			this.redisContainer = startedRedis;
			this.isInitializing = false;

			return this.getClusterInfo();
		} catch (error) {
			this.isInitializing = false;
			await this.stopCluster();
			throw new Error(
				`Failed to initialize Testcontainers cluster: ${(error as Error).message}`,
			);
		}
	}

	/**
	 * Tears down running containers and flushes references safely.
	 */
	public async stopCluster(): Promise<void> {
		await Promise.all([
			this.postgresContainer
				? this.postgresContainer.stop()
				: Promise.resolve(),
			this.redisContainer ? this.redisContainer.stop() : Promise.resolve(),
		]);

		this.postgresContainer = null;
		this.redisContainer = null;
	}

	/**
	 * Compiles connection configurations based on dynamic mapped ports.
	 */
	private getClusterInfo(): ContainerClusterInfo {
		if (!this.postgresContainer || !this.redisContainer) {
			throw new Error(
				"Cannot retrieve cluster info. Containers are not running.",
			);
		}

		// Dynamic extraction ensures no port collisions on host machines
		const databaseUrl = this.postgresContainer.getConnectionUri();

		const redisHost = this.redisContainer.getHost();
		const redisPort = this.redisContainer.getMappedPort(6379);
		const redisUrl = `redis://${redisHost}:${redisPort}`;

		return {
			databaseUrl,
			redisUrl,
		};
	}
}
