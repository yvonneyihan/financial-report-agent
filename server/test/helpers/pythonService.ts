import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
export const TEST_INTERNAL_TOKEN = "test-internal-token-for-vitest";

export interface RunningPythonService {
  baseUrl: string;
  token: string;
  stop: () => Promise<void>;
}

/**
 * Spawn the real `src/internal_api.py` (uvicorn) for integration tests, so
 * the TypeScript <-> Python boundary is exercised against the actual service,
 * not a mock. See IMPLEMENTATION_PLAN.md §2 (typed Python client).
 */
export async function startPythonService(port = 8099): Promise<RunningPythonService> {
  const pythonBin = path.join(REPO_ROOT, ".venv", "bin", "uvicorn");
  const child: ChildProcess = spawn(pythonBin, ["src.internal_api:app", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: { ...process.env, INTERNAL_API_TOKEN: TEST_INTERNAL_TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/internal/v1/health`);
      if (res.ok) {
        return {
          baseUrl,
          token: TEST_INTERNAL_TOKEN,
          stop: () =>
            new Promise<void>((resolve) => {
              child.once("exit", () => resolve());
              child.kill("SIGTERM");
            }),
        };
      }
    } catch (err) {
      lastError = err;
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  child.kill("SIGTERM");
  throw new Error(`finance-core (uvicorn) did not become healthy in time.\nstderr:\n${stderr}`, { cause: lastError });
}
