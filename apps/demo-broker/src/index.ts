import { randomBytes } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export const STOP_DEMO_SCHEDULER = "stop_demo_scheduler" as const;
export type BrokerOperation = typeof STOP_DEMO_SCHEDULER;
export interface BrokerDispatch {
  executionId: string;
  actionId: string;
  operation: BrokerOperation;
  target: { identity: "pantry-demo-scheduler"; generation: string };
  authorization: string;
}
export interface BrokerReceipt {
  executionId: string;
  attemptId: string;
  targetGeneration: string;
  status: "effect_applied" | "already_stopped" | "rejected" | "outcome_unknown";
  observedAt: string;
  reason?: string;
}
export interface VerificationResult {
  result: "verified" | "failed" | "outcome_unknown";
  schedulerReachable: boolean | null;
  controlReachable: boolean | null;
  brokerProcessState: "running" | "stopped" | "unknown";
  observedAt: string;
  reason?: string;
}
export interface ObserverConfig {
  schedulerHealthUrl: string;
  controlHealthUrl: string;
  expectedToken: string;
  readBrokerState: () =>
    | "running"
    | "stopped"
    | "unknown"
    | Promise<"running" | "stopped" | "unknown">;
}
type Ready = {
  generation: string;
  token: string;
  schedulerPort: number;
  controlPort: number;
};
type Reply = {
  requestId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
};

export class DemoBroker {
  readonly targetIdentity = "pantry-demo-scheduler" as const;
  readonly dispatchAuthorization: string;
  readonly generation: string;
  readonly fixtureToken: string;
  readonly schedulerHealthUrl: string;
  readonly controlHealthUrl: string;
  #child: ChildProcess;
  #sequence = 0;
  #cachedState: "running" | "stopped" | "unknown" = "running";
  #closed = false;
  #pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private constructor(
    child: ChildProcess,
    authorization: string,
    ready: Ready,
  ) {
    this.#child = child;
    this.dispatchAuthorization = authorization;
    this.generation = ready.generation;
    this.fixtureToken = ready.token;
    this.schedulerHealthUrl = `http://127.0.0.1:${ready.schedulerPort}/health`;
    this.controlHealthUrl = `http://127.0.0.1:${ready.controlPort}/health`;
    child.on("message", (message: Reply) => this.#onMessage(message));
    child.on("exit", () => {
      this.#cachedState = "unknown";
      for (const item of this.#pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("broker exited"));
      }
      this.#pending.clear();
    });
  }
  static async start(input: {
    dbPath: string;
    schedulerPort?: number;
    controlPort?: number;
  }): Promise<DemoBroker> {
    const authorization = randomBytes(32).toString("base64url");
    const runtime = fileURLToPath(new URL("./runtime.ts", import.meta.url));
    const child = fork(runtime, [], {
      execArgv: [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: {
        BROKER_DB_PATH: input.dbPath,
        BROKER_SCHEDULER_PORT: String(input.schedulerPort ?? 0),
        BROKER_CONTROL_PORT: String(input.controlPort ?? 0),
        BROKER_AUTHORIZATION: authorization,
      },
    });
    let ready: Ready;
    try {
      ready = await new Promise<Ready>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("broker startup timeout")),
          3_000,
        );
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`broker exited during startup (${code})`));
        });
        child.once("message", (message: any) => {
          if (message?.type === "ready") {
            clearTimeout(timer);
            resolve(message.value);
          } else if (message?.type === "startup_error") {
            clearTimeout(timer);
            reject(new Error(message.error));
          }
        });
      });
    } catch (error) {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await waitForChildExit(child, 1_000).catch(() => undefined);
      }
      throw error;
    }
    return new DemoBroker(child, authorization, ready);
  }
  get processState(): "running" | "stopped" | "unknown" {
    return this.#cachedState;
  }
  async readProcessState(): Promise<"running" | "stopped" | "unknown"> {
    const state = await this.#request("state", {});
    this.#cachedState = state;
    return state;
  }
  async dispatch(request: BrokerDispatch): Promise<BrokerReceipt> {
    const result = (await this.#request("dispatch", request)) as BrokerReceipt;
    if (["effect_applied", "already_stopped"].includes(result.status))
      this.#cachedState = "stopped";
    return result;
  }
  async lookup(executionId: string): Promise<BrokerReceipt | null> {
    return this.#request("lookup", {
      executionId,
      authorization: this.dispatchAuthorization,
    });
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    try {
      await this.#request("close", {}, 500);
    } catch {}
    this.#closed = true;
    if (this.#child.exitCode === null) {
      await waitForChildExit(this.#child, 500).catch(() => undefined);
    }
    if (this.#child.exitCode === null) {
      this.#child.kill("SIGTERM");
      await waitForChildExit(this.#child, 1_000).catch(() => undefined);
    }
  }
  #request(type: string, value: unknown, timeoutMs = 3_000): Promise<any> {
    if (this.#closed) return Promise.reject(new Error("broker closed"));
    const requestId = `${process.pid}:${++this.#sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`broker ${type} IPC timeout`));
      }, timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timer });
      this.#child.send?.({ type, requestId, value }, (error) => {
        if (error) {
          const pending = this.#pending.get(requestId);
          if (pending) clearTimeout(pending.timer);
          this.#pending.delete(requestId);
          reject(error);
        }
      });
    });
  }
  #onMessage(message: Reply): void {
    if (!message?.requestId) return;
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(message.requestId);
    message.ok
      ? pending.resolve(message.value)
      : pending.reject(new Error(message.error));
  }
}

export class IndependentObserver {
  readonly #config: ObserverConfig;
  constructor(config: ObserverConfig) {
    this.#config = config;
  }
  async verifyStopped(): Promise<VerificationResult> {
    const [scheduler, control, brokerProcessState] = await Promise.all([
      probe(this.#config.schedulerHealthUrl, this.#config.expectedToken),
      probe(this.#config.controlHealthUrl, this.#config.expectedToken),
      Promise.resolve(this.#config.readBrokerState()).catch(
        () => "unknown" as const,
      ),
    ]);
    const observedAt = new Date().toISOString();
    if (control !== true || brokerProcessState === "unknown")
      return {
        result: "outcome_unknown",
        schedulerReachable: scheduler,
        controlReachable: control,
        brokerProcessState,
        observedAt,
        reason: "observer control or process evidence unavailable",
      };
    if (scheduler === false && brokerProcessState === "stopped")
      return {
        result: "verified",
        schedulerReachable: false,
        controlReachable: true,
        brokerProcessState,
        observedAt,
      };
    if (scheduler === true || brokerProcessState === "running")
      return {
        result: "failed",
        schedulerReachable: scheduler,
        controlReachable: true,
        brokerProcessState,
        observedAt,
        reason: "scheduler still running or reachable",
      };
    return {
      result: "outcome_unknown",
      schedulerReachable: scheduler,
      controlReachable: true,
      brokerProcessState,
      observedAt,
      reason: "incomplete independent evidence",
    };
  }
}
async function probe(url: string, token: string): Promise<boolean | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return false;
    const body = (await response.json()) as any;
    return body?.healthy === true && body?.token === token;
  } catch (error: any) {
    return error?.name === "TimeoutError" ? null : false;
  }
}
function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("exit", done);
      reject(new Error("broker termination timeout"));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", done);
  });
}
