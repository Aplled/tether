# Tether build contract

Approved company plan: `docs/TETHER-COMPANY-PLAN.md`. This contract fixes the three workers' integration points. Lead owns this file. Existing backend and mesh regression fixtures remain intact. All implementation workers are GPT-5.6 Sol.

## Ownership

- Security: `apps/tether/{auth,permissions,response}.ts`, their tests, `docs/TETHER-SECURITY.md`, and **`fixtures/northstar/retry-service.ts` plus its test**. No other worker writes that service.
- Company backend: `apps/tether/{types,company,seed,imports,scheduling,handoffs,server}.ts`, their tests, other Northstar fixture data, package scripts.
- Canvas: `apps/tether/public/**`, optional canvas test only.
- Lead: integration decisions, documentation, review, final verification. Resolve contract changes here and notify both affected owners.

## Stable identity and persistence

Organization ID `northstar`, name Northstar Compute. Stable presentation member IDs: `employee-ava`, `employee-noah`, `employee-priya`, `employee-elena`. Logins are the first names at `northstar.local`. Account credentials are generated once into `.runtime/tether/bootstrap-accounts.json`, directory mode 0700/file mode 0600. Never log or send passwords/tokens in progress output. No browser persona selector. Other directory profiles are not provisioned logins unless an admin activates them.

Use separate auth and company SQLite databases under `.runtime/tether`. Company store is the single source of current memberships and grants. Auth stores only credentials and opaque hashed sessions. Current title/role/policy/grants must be looked up on every authenticated request and delivery, not copied permanently into a session. Roles and grants are administrator-controlled, never inferred from imported display titles.

Security's existing exports are accepted: `AuthService({dbPath,runtimeDir,membershipLookup,clock?,sessionTtlMs?,...})`; `bootstrapPresentationAccounts()`, `signIn(login,password,clientKey?) -> {token,context}`, `authenticate(token) -> AuthContext`, `logout(token)`, account activation/revocation, `close()`. `MembershipSnapshot`, `AuthContext`, `ResourceGrant`, `authorize`, `roleTemplate` live in `permissions.ts`. Backend adapts canonical records into these interfaces. Coordinate extension before adding a second incompatible role/grant type. The baseline template plus an applicable current resource grant is required. Incident approval requires a distinct explicit commander capability; organization admin alone never implies approval.

`TetherCompanyStore` owns canonical `CompanyState` from `types.ts`. Preserve its current keys (`organization`, `departments`, **`members`**, `nodes`, `edges`, `regions`, `repositories`, `incidents`, `tasks`, `messages`, `notifications`, `grants`, `eventCursor`). Extend with workspaces, runs, delegations, etc. as needed. `organization.semanticRevision` changes on graph/evidence/source/authority semantics; node layout changes use layoutRevision and must not invalidate an otherwise current proposal. Conflicting semantic edits fail clearly. Every mutation is narrow; never accept an entire client-supplied authoritative state.

## HTTP wire contract

Loopback server on port 4173 by default. Same-origin browser assets; no arbitrary CORS. Bounded bodies, strict Origin/Host checks, CSP, safe text rendering. API responses JSON. Errors `{error: string, code: string}` with useful 400/401/403/409/429 status. Unknown action names reject. Never accept client actor IDs as authority.

- `POST /api/login` body `{email,password}` -> `{token,expiresAt,user}`. Also accept `login` as a compatibility alias if useful. `user` is public identity with id, name, email, title, departmentId, role.
- `POST /api/logout` bearer token -> `{ok:true}`.
- `GET /api/state` bearer token -> `ViewState` below.
- `GET /api/events?cursor=N` bearer token via **fetch streaming**, not native EventSource. SSE records `id: <cursor>`, `event: state`, `data: <ViewState JSON>`. Reconnect from last cursor; initial/reconnect snapshot is allowed. Verify current session and current membership/grants before every payload. Persist records first, then publish. No global raw event payload. Revoke invalid sessions/streams promptly. Heartbeats carry no private data.
- `POST /api/actions` bearer body `{type,payload,idempotencyKey?,expectedRevision?}` -> `{state:ViewState,result?:unknown}`. Successful mutation returns current filtered state. Idempotency keys mandatory for message creation and incident creation; UI supplies UUID. Expected record/semantic revisions must guard destructive or semantic edits.
- `GET /api/source?id=<repositoryReferenceId>` bearer -> `{path,revision,lineStart?,lineEnd?,text}`. Resolve from approved local repository/path allowlist only; reject traversal/symlinks outside roots and inaccessible references. No arbitrary URL fetching or filesystem browser.

`ViewState` uses the canonical keys above but is **already filtered server-side**. Additional required keys:

```ts
{
  user: {id,name,email,title,departmentId,role},
  permissions: string[], // effective current UI affordances, never client authority
  model: {configured:boolean,model:string,mode:string},
  integrations: {identity:"local",database:"sqlite",realtime:"server",supabaseConnected:false},
  analysis: null | {incidentId, mode:"live"|"scripted", provider,model,summary,steps,recommendation,reason?},
  proposal: null | {id,incidentId,action,target,semanticRevision,digest,status,...},
  eventCursor: number,
  // canonical arrays, each scoped to current user
}
```

Backend may add fields without renaming these. Canvas must tolerate empty arrays/null analysis. An ordinary fresh startup has no incident, analysis, or proposal. Server sends only safe notices plus ordinary authorized company context to marketing; **no hidden incident IDs, titles, tasks, source mappings, run steps, counts, or messages**. Directory public identity fields and private schedule/contact fields use separate projections. Privileged settings/grants are not exposed wholesale.

## Actions and payloads

Use these stable names. UI may leave advanced forms compact but controls must work.

- `member.create`: `{name,email,departmentId,team,jobFamily,level,title,managerId?,timezone?}`; admin assigns trusted template separately. Returns created member.
- `member.update`: `{id,revision,patch}` restricted fields. Self may update own hours/availability/preferences; only admin updates trusted role/title/department/manager/active.
- `member.activate`: `{id}` admin, create real login if requested; return one-time local setup credential only to authorized admin, never include in event/state. `member.revoke`: `{id,revision}`.
- `node.create`: `{name,kind,description,regionId,ownerId?,criticality,x,y}`.
- `node.update`: `{id,semanticRevision,patch}`. `node.move`: `{id,x,y,layoutRevision}`. `node.delete`: `{id,semanticRevision}`.
- `edge.create`: `{sourceId,targetId,kind,label?,optional?}`. `edge.delete`: `{id,revision}`.
- `repository.save`: `{id?,nodeId,repository:"local:hackutd",revision,path,lineStart?,lineEnd?}`; admin only. Actual source mapping validation required.
- `import.preview`: `{format:"employees_csv"|"systems_csv"|"catalog_json",content:string}` -> result `{previewId,rows,errors,warnings,summary}`. `import.commit`: `{previewId,semanticRevision}` -> inserted/updated counts. Preview bounded and server-retained, titles cannot auto-promote, no formula execution or remote catalog fetch.
- `incident.create`: `{title,observation,nodeIds,regionId?,memberIds?}`; creates explicit workspace, no inferred certainty. Returns incident/workspace.
- `incident.update`: `{id,revision,patch}` allowed title/observation/status/memberIds/commanderId as authorized; workspace membership/grants update atomically. `incident.acknowledge`: `{id}`.
- `workspace.update`: `{id,revision,memberIds?,nodeIds?,name?}` admin/commander only; changing membership affects immediate projection/delivery. No implicit source grants.
- `task.create`: `{incidentId,title,ownerId,nodeIds}`. `task.update`: `{id,revision,status?,ownerId?,title?}`. Non-admin responder can update own scoped task status, not assign arbitrary users.
- `message.send`: `{incidentId,text,nodeId?,taskId?}` with idempotency key. Validate every parent relationship/scope. Durable server sequence and createdAt.
- `notification.read`: `{id}` self only.
- `settings.update`: `{workingHours?,timezone?,availability?,availabilityUntil?,leave?,notifications?,onCallWindows?}` self; validate IANA timezone, bounded intervals and opt-in. Admin availability override does not manufacture after-hours consent.
- `delegation.save`: `{id?,fromId,toId,startsAt,endsAt,capabilities,resourceIds}` authorized admin; only preexisting recipient capabilities, no auto promotion. `escalation.check`: `{incidentId}` -> result explaining eligible/skipped/unassigned/approvalBlocked, persisted dedup bounded attempts; no real email/SMS delivery.
- `analysis.run`: `{incidentId,message?}` explicit. Backend builds MCP tool responses from **current canonical company graph scoped to authenticated user/incident**. Reuse bounded existing model adapter with honest `live`/`scripted` mode. Add tasks from validated factual results, not arbitrary model grants/actions.
- `brief.generate`: `{taskId}` -> result `{id,taskId,generatedAt,snapshotRevision,stale:false,text}`. `brief.copy`: `{id}` checks current assignment/grants/evidence/source revision; stale returns 409. Copy log records export metadata, never token/full sensitive prompt. Browser previews then copies exact result text.
- `response.prepare`: `{incidentId}` creates exact proposal from current analysis/graph/evidence and fixed target.
- `response.approve`: `{proposalId,digest}` explicit current commander only, response owner enforces full checks. Approve+execute may be one deliberate button/request if exact action shown first. Never infer approval from analysis.
- `response.fallback`: `{incidentId}` explicit only after containment independently verified. `response.resolve`: `{incidentId}` only after actual acceptance checks.

## Fixed response fixture and security interface

Security owns **`fixtures/northstar/retry-service.ts`** and its isolated local process lifecycle. The source links point at real fixture source and tests. Fixed bug: `POST /api/v1/jobs/:jobId/retry` initially lacks a tenant ownership check for an isolated synthetic job; one fixed scoped action disables/stops the isolated retry service, independently observed; a safe fallback denies cross-tenant retry and permits same-tenant work. No arbitrary shell, process ID, path, host, Docker control, tenant, or command from a user/model. Independent observer checks actual fixed service/control behavior; a status boolean is insufficient.

Security exports `ResponseAuthority`, constructed with a runtime directory plus callbacks to **current** membership, grants, graph/evidence snapshot, incident commander, and fixed target generation. Backend and security owners should agree exact constructor/method signatures directly now, then record them here. Minimal operations: initialize/start fixed fixture, inspect current actual state, prepare proposal, approve+execute exact digest, verify fallback, verify resolution, close. Responses must be JSON serializable. Stale graph/evidence/grant/commander/target generation denies action. Idempotent retries cannot repeat execution. Layout movement alone is not stale semantics.

## Current integration record

The company MCP bridge is implemented in `apps/tether/mcp.ts`: official SDK client/server 2.4.0 negotiate modern protocol `2026-07-28` through an internal StreamableHTTP request handler. There is no public unauthenticated MCP endpoint. Seven read/simulation tools operate on current authorized canonical scope with per-call reauthentication, strict inputs, a six-call budget, deadline, and bounded results. Company analysis is partitioned by employee, policy, incident, semantic revision, and readable scope. A changed scope during a run rejects its stale output. This is actual protocol transport; live Nemotron inference is a separate claim and remains subject to provider evidence.

The state wire exposes `analysisByIncident` and `proposalsByIncident`, keyed only by currently readable incident IDs. Frontend panels use these maps instead of the compatibility global fields. Each proposal entry is the latest action for that incident; pending proposals show `stale_context` after semantic, evidence, or commander-policy changes and `stale_target` after target replacement. Re-preparing binds a fresh source ID to the full analysis/context/target/policy snapshot. Marketing receives empty maps. Coverage eligibility details require current incident-assignment authority.

Trusted `Member.roleTemplate` values are persisted. New/imported people default to `member`; display title does not grant authority. The data science manager can read a repository only with its explicit current grant, including the real training-catalog definition source in `apps/tether/seed.ts`.

## Verification gate

Existing 60 core checks and nine legacy web checks remain regressions. Add meaningful auth/session isolation, current grants/revocation, marketing non-disclosure, scoped message/task/source reads and writes, persistence/reconnect/idempotency, import privilege prevention, canonical graph changes impacting analysis, after-hours opt-out/no-approver behavior, stale brief/proposal rejection, actual fixed retry containment/fallback tests. Lead verifies four actual browser sessions and portrait interaction after integration. Supabase remains unconfigured until correct dedicated Tether access is independently verified. Keep local storage limitations and synthetic provenance in docs, while normal product UI remains realistic.
