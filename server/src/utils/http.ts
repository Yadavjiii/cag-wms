import { Request, Response, NextFunction, RequestHandler } from "express";

/** Wraps an async route so thrown errors reach the error middleware. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** Error with an HTTP status code, caught by the error middleware. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
