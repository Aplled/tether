# Tether local security boundary

Tether currently uses a local authenticated backend with synthetic Northstar data. It does not claim a deployed Supabase integration. The unrelated Supabase project was not inspected or changed.

## Identity and sessions

`apps/tether/auth.ts` provisions the four presentation accounts once. It writes the one-time local setup credentials to `.runtime/tether/bootstrap-accounts.json`; the directory is mode `0700` and the file is mode `0600`. Passwords use a random 16-byte salt and Node's scrypt implementation. Raw passwords and bearer tokens are not written to the database or logs.

Successful login returns a random 32-byte opaque bearer token. Only its SHA-256 verifier is stored. Sessions have a server-enforced absolute expiry and logout/revocation invalidates the server record. Authentication looks up the current company membership on every request, so deactivation and trusted role or policy changes take effect without trusting client state. Failed login attempts are bounded per normalized login and server-supplied client key within a sliding window.

The browser uses separate per-tab token state for the four-view presentation. This isolates ordinary tabs from one another, but JavaScript in the same origin can read browser-managed bearer state. It is not an XSS boundary. A production browser deployment should prefer a reviewed Backend-for-Frontend or secure `HttpOnly` cookie design and add idle timeout, renewal, stronger source-rate signals, account recovery, and protected secret storage. The current SQLite files are ordinary local databases and are not encrypted at rest, so they contain synthetic data only.

The implementation follows Node's documented `randomBytes`, `scrypt`, and `timingSafeEqual` primitives: [Node.js crypto documentation](https://nodejs.org/download/release/v26.7.0/docs/api/crypto.html). The session design follows OWASP's requirements for meaningless high-entropy server-side session identifiers, server-side expiry, and logout invalidation: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). Scrypt selection and per-password salts follow [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

## Authorization

`apps/tether/permissions.ts` combines a trusted administrator-assigned role template with a current resource grant. A role template alone cannot grant repository, node, incident, task, or notice access. Every check binds employee, organization, resource kind and ID, capability, policy revision, grant expiry, and current membership.

Incident approval is deliberately separate from organization administration. The approver must be the current incident commander, have the trusted `senior_manager` template, and hold a current explicit `incident:approve` grant for that incident. The checks repeat immediately before dispatch. Marketing has only explicit low-detail notice access; it receives no incident, responder conversation, task, exploit, or repository scope.

The server must derive `AuthContext` from `AuthService.authenticate(token)`. It must never construct it from request fields or accept an actor ID, role, organization, revision, or grant claim from the client.

## Fixed response authority

`fixtures/northstar/retry-service.ts` is an isolated local process with two fixed synthetic jobs. Its primary retry route intentionally reproduces the missing ownership check: tenant A can retry tenant B's job. The separate fallback checks job ownership, returning `403` for the cross-tenant request and `202` for the same-tenant request.

`apps/tether/response.ts` exposes one operation against one identity and one generated target generation: `disable_cross_tenant_retry` on `northstar-retry-api`. No user or model can supply a URL, path, command, process ID, tenant, or shell input. A response action binds the organization, incident, source proposal and context digests, semantic revision, evidence revision, policy revision, commander, explicit approval grant, target identity, and generation. Layout-only changes do not participate in the semantic revision.

Execution reserves the action durably before IPC. Concurrent calls cannot dispatch the effect twice. The observer checks the actual retry route, the separate control health endpoint, cross-tenant fallback denial, and same-tenant fallback success. A model can propose an action; only the current human commander with the explicit grant can approve it. Restart during a reserved dispatch fails closed as an in-progress/unknown outcome and requires operator reconciliation; the implementation does not blindly repeat the effect.

This fixture proves the bounded local behavior only. It does not prove production containment, production tenant isolation, or infrastructure security. Resolution evidence means the fixed fallback path passed the explicit same-tenant and cross-tenant acceptance checks while the vulnerable route remained disabled.

## Persistence and remaining limits

The auth and response databases use SQLite WAL mode for local concurrency; SQLite documents the additional WAL file and checkpoint behavior in [Write-Ahead Logging](https://www.sqlite.org/wal.html). Runtime directory permissions restrict normal same-machine access but do not resist a compromised user account, administrator, kernel, or running process. Backups, WAL files, and process memory remain in scope for host protection.

The current build still needs production-grade TLS/off-host transport, encrypted storage and key management, security event export, idle session expiry, credential reset, dependency scanning, and a deployment threat review before real company or customer data is used.
