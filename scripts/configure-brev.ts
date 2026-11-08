import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  chmod,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FIELDS = {
  NVIDIA_BASE_URL: "http://127.0.0.1:8000/v1",
  NVIDIA_MODEL: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16",
  NVIDIA_PROVIDER_LABEL: "Brev / vLLM",
} as const;

export type ConfigureBrevResult = {
  path: string;
  configuredFields: string[];
};

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
}

async function requirePrivateKey(root: string): Promise<string> {
  const keyPath = join(root, ".runtime", "tether", "nemotron-api-key");
  const metadata = await lstat(keyPath);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("Nemotron API key must be a regular file");
  if ((metadata.mode & 0o077) !== 0)
    throw new Error("Nemotron API key permissions must be 0600 or stricter");
  const resolvedKey = await realpath(keyPath);
  if (!inside(root, resolvedKey))
    throw new Error("Nemotron API key resolves outside the project root");
  const key = (await readFile(resolvedKey, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error(
      "Nemotron API key must be exactly 32 bytes encoded as hexadecimal",
    );
  return key;
}

function updateEnv(source: string, values: Record<string, string>): string {
  const pending = new Set(Object.keys(values));
  const lines = source ? source.replace(/\r\n/g, "\n").split("\n") : [];
  const output: string[] = [];
  for (const line of lines) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const name = match?.[1];
    if (!name || !(name in values)) {
      output.push(line);
      continue;
    }
    if (pending.delete(name)) output.push(`${name}=${values[name]}`);
  }
  while (output.length && output.at(-1) === "") output.pop();
  if (output.length && pending.size) output.push("");
  for (const name of Object.keys(values)) {
    if (pending.has(name)) output.push(`${name}=${values[name]}`);
  }
  return `${output.join("\n")}\n`;
}

export async function configureBrev(
  projectRoot: string,
): Promise<ConfigureBrevResult> {
  const root = await realpath(resolve(projectRoot));
  const key = await requirePrivateKey(root);
  const envPath = join(root, ".env.local");
  let source = "";
  try {
    const metadata = await lstat(envPath);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error(".env.local must be a regular file");
    const resolvedEnv = await realpath(envPath);
    if (!inside(root, resolvedEnv))
      throw new Error(".env.local resolves outside the project root");
    source = await readFile(resolvedEnv, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const values: Record<string, string> = {
    NVIDIA_BASE_URL: FIELDS.NVIDIA_BASE_URL,
    NVIDIA_MODEL: FIELDS.NVIDIA_MODEL,
    NVIDIA_API_KEY: key,
    NVIDIA_PROVIDER_LABEL: FIELDS.NVIDIA_PROVIDER_LABEL,
  };
  const next = updateEnv(source, values);
  await mkdir(dirname(envPath), { recursive: true });
  const temporary = join(root, `.env.local.${process.pid}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(next, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, envPath);
    await chmod(envPath, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
  return { path: envPath, configuredFields: Object.keys(values) };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await configureBrev(process.cwd());
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
