import type { Socket } from "socket.io";

export interface SocketData {
	userId: string;
}

export type AuthenticatedSocket = Socket<
	never, // Incoming client events are ignored for now (one-way server-to-client push)
	never, // Outgoing event payloads can be untyped or expanded globally
	never,
	SocketData
>;
