import { z } from "zod";

const falEnvSchema = z.object({
  FAL_KEY: z.string().trim().min(1).optional(),
  FAL_BASE_URL: z.string().url().optional(),
  FAL_QUEUE_BASE_URL: z.string().url().optional(),
});

export type FalConfig = {
  apiKey: string;
  baseUrl: string;
  queueBaseUrl: string;
  timeoutMs: number;
};

export type FalConnectionStatus = {
  configured: boolean;
  status: "reachable" | "unreachable" | "not_configured";
  message: string;
  checkedAt: string;
};

type FalLogger = {
  error: (details: { event: string; status: FalConnectionStatus["status"] }, message: string) => void;
};

const defaultLogger: FalLogger = {
  error: (details, message) => console.error(message, details),
};

export function loadFalConfig(env: NodeJS.ProcessEnv = process.env): FalConfig | null {
  const parsed = falEnvSchema.safeParse(env);
  if (!parsed.success || !parsed.data.FAL_KEY) return null;

  return {
    apiKey: parsed.data.FAL_KEY,
    baseUrl: (parsed.data.FAL_BASE_URL ?? "https://api.fal.ai").replace(/\/$/, ""),
    queueBaseUrl: (parsed.data.FAL_QUEUE_BASE_URL ?? "https://queue.fal.run").replace(/\/$/, ""),
    timeoutMs: 5_000,
  };
}

export function assertFalConfiguredForProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production" && !loadFalConfig(env)) {
    throw new Error("FAL_KEY is absent. Configure the FAL_KEY deployment secret before starting production.");
  }
}

export function assertFalWebhookConfiguredForProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production" || env.FAL_WEBHOOK_ENABLED !== "true") return;
  let webhookUrl: URL;
  try { webhookUrl = new URL(env.FAL_WEBHOOK_URL ?? ""); } catch { throw new Error("FAL_WEBHOOK_URL is required and must be an HTTPS public URL before enabling FAL_WEBHOOK_ENABLED."); }
  if (webhookUrl.protocol !== "https:") throw new Error("FAL_WEBHOOK_URL must use HTTPS before enabling FAL_WEBHOOK_ENABLED.");
}

export function createFalClient(
  config: FalConfig,
  dependencies: { fetchImpl?: typeof fetch; logger?: FalLogger } = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const logger = dependencies.logger ?? defaultLogger;

  return {
    async checkConnection(): Promise<FalConnectionStatus> {
      const checkedAt = new Date().toISOString();
      try {
        const response = await fetchImpl(`${config.baseUrl}/v1/models?limit=1`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Key ${config.apiKey}`,
          },
          signal: AbortSignal.timeout(config.timeoutMs),
        });

        if (!response.ok) {
          const status: FalConnectionStatus = {
            configured: true,
            status: "unreachable",
            message: "FAL rejected the connection check. Verify the deployment secret and account access.",
            checkedAt,
          };
          logger.error({ event: "fal_connection_check_failed", status: status.status }, "FAL connection check failed");
          return status;
        }

        return {
          configured: true,
          status: "reachable",
          message: "FAL configuration is present and the account-safe model check succeeded.",
          checkedAt,
        };
      } catch {
        const status: FalConnectionStatus = {
          configured: true,
          status: "unreachable",
          message: "FAL connection check could not be completed. Verify network access and the deployment secret.",
          checkedAt,
        };
        logger.error({ event: "fal_connection_check_failed", status: status.status }, "FAL connection check failed");
        return status;
      }
    },
  };
}

export function getFalConnectionStatus(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: { fetchImpl?: typeof fetch; logger?: FalLogger } = {},
): Promise<FalConnectionStatus> {
  const config = loadFalConfig(env);
  if (!config) {
    return Promise.resolve({
      configured: false,
      status: "not_configured",
      message: "FAL_KEY is not configured for this deployment.",
      checkedAt: new Date().toISOString(),
    });
  }
  return createFalClient(config, dependencies).checkConnection();
}
