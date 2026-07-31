import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { getToken } from "./api/client";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
const SOCKET_URL = API_URL.replace(/\/api\/?$/, "");

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, { auth: { token: getToken() }, transports: ["websocket", "polling"] });
  }
  return socket;
}

/** Re-authenticate the socket after login/logout with the current token. */
export function reconnectRealtime(): void {
  if (!socket) return;
  socket.auth = { token: getToken() };
  socket.disconnect();
  socket.connect();
}

/** Subscribe a component to a realtime event for its lifetime. */
export function useRealtime(event: string, handler: (payload: unknown) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    const fn = (p: unknown) => ref.current(p);
    s.on(event, fn);
    return () => {
      s.off(event, fn);
    };
  }, [event]);
}
