import { Server as IOServer } from "socket.io";
import type http from "http";
import jwt from "jsonwebtoken";
import { config } from "./config";

let io: IOServer | null = null;
const online = new Map<string, number>(); // userId -> open connection count

export function initRealtime(server: http.Server): void {
  io = new IOServer(server, { cors: { origin: config.clientOrigin, credentials: true } });

  // Authenticate every socket with the same JWT used by the REST API.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("No token"));
    try {
      const payload = jwt.verify(token, config.jwtSecret) as unknown as { sub: string };
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
    online.set(userId, (online.get(userId) ?? 0) + 1);
    emitPresence();

    socket.on("disconnect", () => {
      const n = (online.get(userId) ?? 1) - 1;
      if (n <= 0) online.delete(userId);
      else online.set(userId, n);
      emitPresence();
    });
  });
}

function emitPresence(): void {
  io?.emit("presence", { count: online.size });
}

/** Send an event to one user's devices (all their open tabs). */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** Broadcast an event to everyone connected. */
export function broadcast(event: string, payload: unknown): void {
  io?.emit(event, payload);
}
