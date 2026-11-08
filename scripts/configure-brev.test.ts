import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configureBrev } from "./configure-brev.ts";

const KEY = "a".repeat(64);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "configure-brev-"));
  const keyDirectory = join(root, ".runtime", "tether");
  await mkdir(keyDirectory, { recursive: true });
  await writeFile(join(keyDirectory, "nemotron-api-key"), `${KEY}\n`, {
    mode: 0o600,
  });
  return root;
}

test("configures private local environment without disclosing or replacing unrelated values", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, ".env.local"),
    "# operator settings\nUNRELATED=keep-me\nNVIDIA_MODEL=old\n",
    { mode: 0o644 },
  );

  const first = await configureBrev(root);
  const once = await readFile(first.path, "utf8");
  assert.equal((await stat(first.path)).mode & 0o777, 0o600);
  assert.match(once, /^# operator settings$/m);
  assert.match(once, /^UNRELATED=keep-me$/m);
  assert.match(once, /^NVIDIA_BASE_URL=http:\/\/127\.0\.0\.1:8000\/v1$/m);
  assert.match(
    once,
    /^NVIDIA_MODEL=nvidia\/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16$/m,
  );
  assert.match(once, /^NVIDIA_PROVIDER_LABEL=Brev \/ vLLM$/m);
  assert.match(once, new RegExp(`^NVIDIA_API_KEY=${KEY}$`, "m"));
  assert.ok(!JSON.stringify(first).includes(KEY));

  const second = await configureBrev(root);
  assert.equal(await readFile(second.path, "utf8"), once);
  for (const name of first.configuredFields)
    assert.equal(once.match(new RegExp(`^${name}=`, "gm"))?.length, 1);
});

test("rejects insecure, symlinked, and out-of-root key files", async (t) => {
  const insecure = await fixture();
  const linked = await mkdtemp(join(tmpdir(), "configure-brev-link-"));
  const escaped = await mkdtemp(join(tmpdir(), "configure-brev-escape-"));
  const outside = await mkdtemp(join(tmpdir(), "configure-brev-outside-"));
  t.after(() =>
    Promise.all(
      [insecure, linked, escaped, outside].map((path) =>
        rm(path, { recursive: true, force: true }),
      ),
    ),
  );

  await writeFile(
    join(insecure, ".runtime", "tether", "nemotron-api-key"),
    KEY,
    { mode: 0o644 },
  );
  await chmod(join(insecure, ".runtime", "tether", "nemotron-api-key"), 0o644);
  await assert.rejects(configureBrev(insecure), /permissions/);

  await mkdir(join(linked, ".runtime", "tether"), { recursive: true });
  await writeFile(join(linked, "actual-key"), KEY, { mode: 0o600 });
  await symlink(
    join(linked, "actual-key"),
    join(linked, ".runtime", "tether", "nemotron-api-key"),
  );
  await assert.rejects(configureBrev(linked), /regular file/);

  await writeFile(join(outside, "nemotron-api-key"), KEY, { mode: 0o600 });
  await mkdir(join(escaped, ".runtime"), { recursive: true });
  await symlink(outside, join(escaped, ".runtime", "tether"));
  await assert.rejects(configureBrev(escaped), /outside the project root/);
});
