import assert from "node:assert/strict";
import test from "node:test";
import {
  RetryServiceObserver,
  RetryServiceTarget,
} from "../../apps/tether/response.ts";

test("Northstar retry fixture exposes the bounded bug and a tenant-isolating fallback", async () => {
  const target = await RetryServiceTarget.start();
  try {
    assert.equal((await target.inspectActualState()).retryRouteEnabled, true);
    const vulnerable = await fetch(
      `${target.serviceUrl}/api/v1/jobs/job-tenant-b/retry`,
      { method: "POST", headers: { authorization: "Bearer tenant-a" } },
    );
    assert.equal(vulnerable.status, 202);
    const fallback = await new RetryServiceObserver(target).verifyFallback();
    assert.deepEqual(
      {
        verified: fallback.verified,
        crossTenantDenied: fallback.crossTenantDenied,
        sameTenantAccepted: fallback.sameTenantAccepted,
      },
      { verified: true, crossTenantDenied: true, sameTenantAccepted: true },
    );
  } finally {
    await target.close();
  }
});
