import { TestContainerOrchestrator } from "../helpers/containers.js";

export async function startE2EContainers() {
	const orchestrator = TestContainerOrchestrator.getInstance();
	return orchestrator.startCluster();
}

export async function stopE2EContainers() {
	const orchestrator = TestContainerOrchestrator.getInstance();
	return orchestrator.stopCluster();
}
