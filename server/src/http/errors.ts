import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../domain/errors.js";

export function errorHandler(err: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof AppError) {
    if (err.httpStatus >= 500) request.log.error({ err }, err.message);
    else request.log.info({ code: err.code }, err.message);
    reply.code(err.httpStatus).send({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    reply.code(400).send({ error: { code: "validation_error", message: err.message, issues: err.issues } });
    return;
  }

  const fastifyErr = err as FastifyError;
  if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
    reply.code(fastifyErr.statusCode).send({ error: { code: fastifyErr.code ?? "bad_request", message: err.message } });
    return;
  }

  request.log.error({ err }, "Unhandled error");
  reply.code(500).send({ error: { code: "internal_error", message: "An unexpected error occurred." } });
}
