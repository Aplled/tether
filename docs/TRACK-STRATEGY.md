# HackUTD track strategy

**Current override:** The user restored the original infinite canvas idea, is building solo, selected **NVIDIA + NMC²**, and authorized demo UI/input/model implementation. The Photon recommendation, ideation pause, and four-person split below are historical. Sponsor facts remain reference material. NVIDIA requires actual Nemotron use beyond chat; a scripted fallback alone does not fulfill that requirement.

**Status:** Lead recommendation for current team planning, based on the complete 123-page opening deck. It is not user approval for a full product pivot, organizer approval, recruiter eligibility confirmation, or evidence that sponsor integrations are complete.
**Source reviewed:** `/Users/vyomsingh/Downloads/Public HackUTD Opening Ceremony Slides.pdf` (unchanged; SHA-256 `f74ce4ff938669f09f3d255117e02e8211f722f368126ca3f176376f4e706ae5`); all 123 pages were rendered under `.runtime/track-review/` for visual inspection. The current public [Hackerpack](https://hackutd-2026.notion.site/3b163cec774080bea6c5fb7358a42dac) was also checked.
**Current technical checkpoint:** The frozen backend passes 60 tests and demonstrates the mandatory response/containment/fallback loop plus encrypted A-to-B-to-C relay across three local peer processes. It has no product UI, free-form incident input, or deployed model adapter.

## Recommendation

The product remains an **infinite operational canvas**, not a single-purpose data-center incident tool. People, teams, services, operations, resources, tasks, backup plans, and incidents share one workspace. Users connect them with meaningful labeled edges such as `DEPENDS_ON`, `OWNED_BY`, `ASSIGNED_TO`, `ALTERNATIVE_TO`, and `APPROVED_BY`.

When a node fails, the product traces the affected connections, focuses the canvas on what matters, and brings the responsible owners, tasks, backup plans, communications, and approvals into view. The full canvas remains available. The data-center incident is one fictional demonstration scenario for that product.

Authority is visible in the same workspace but remains distinct from graph layout. Owning a resource, assigning work, approving an action, and executing an action are separate powers. Creating a connection, dragging a node, receiving a message, or generating model text never grants permission. The existing server policy remains the enforcement boundary.

AI reads the scoped canvas through MCP and proposes explained next steps. Eligible humans approve exact actions. Communications stay attached to the relevant incident, node, task, and handoff so the canvas remains the shared operational context.

Keep this product center and narrow only the fictional demonstration to **data-center incident response and evidence-linked handoffs**.

Enter **NMC² + Photon** if a short Photon spike proves a substantive human conversation round trip and track eligibility. Use **NMC² + NVIDIA** if Photon cannot be proven quickly. NVIDIA can still be used for mentoring or Nemotron experimentation without claiming an NVIDIA entry.

This is a presentation and integration direction, not authorization to replace the core product. Both accepted pillars remain mandatory:

1. deterministic response, exact-action local approval, broker-owned disposable-process stop, independent verification, and verified fallback;
2. encrypted three-local-peer relay with durable queues, signed recipient acknowledgments, replay rejection, and relay restart recovery.

NMC² is the best reuse fit. Its challenge asks teams to help data-center operators stay ahead of missed warnings, unclear handoffs, and badly timed information. The existing incident graph, bounded tools, response coordinator, fallback loop, and resilient relay can support that story without inventing a new product.

## Current implementation boundary

Implemented and verified now: deterministic graph/domain logic, server-enforced policy and exact-action response, bounded MCP tools, durable fallback/task state, and encrypted three-local-peer relay. The interactive infinite canvas, node/edge editor, real deployed AI adapter, and human workflow interfaces are not built yet. The sponsor direction must not turn those missing product surfaces into completed claims.

## Four-person human work split

| Person | Focus |
| --- | --- |
| Vyom | Real AI/model adapter and overall integration with the existing MCP/policy backend; Teammate 3 owns the Photon module |
| Teammate 1 | Infinite canvas, node/edge rendering, labeled connections, interaction, and incident-focused view |
| Teammate 2 | Node/edge input, local API wiring, fictional data-center fixture, and persistence integration |
| Teammate 3 | People, roles, tasks, approval interface, and Photon communications attached to incidents/nodes; reuse existing authority service and do not claim new role enrollment |

The agent security owner supports every boundary: canvas actions, input validation, authority display, Photon identity, model scope, and exact-action approval. Human teammates own the product work; agents implement bounded assignments under the existing GPT-5.6 Sol and single-writer rules.

Photon adds the most advanced explicit interview stage in the deck: its winner is fast-tracked to a **final interview round**, although the role and eligibility are unspecified. T-Mobile separately offers internship interviews to every member of all top-three teams. The Photon entry must use Photon APIs extensively and show real human participation; a one-way alert is insufficient. A valid first-class workflow is:

1. send a scoped incident alert;
2. let the human ask a question answered through read-only, incident-scoped tools;
3. collect a task-owner check-in;
4. create an evidence-linked handoff;
5. keep final exact-action approval in the trusted local flow.

Photon messages and model-generated text can ask, explain, and propose. They cannot approve containment, grant authority, or alter trusted execution scope. Use fictional data only.

Treat inbound Photon content as untrusted. Bind a fictional sender to a verified demo identity through an allowlisted enrollment record rather than trusting a phone number alone. Apply replay and rate bounds, redact read-only MCP responses to incident scope, persist local correlation and delivery state, and make retries idempotent. Messages cannot change authority or issue approval/execution commands. A qualifying demo needs bidirectional question/answer, acknowledgment or task check-in, evidence-linked handoff, and visible delivery state.

Proposed go/no-go timebox: attempt a working round trip within 60 minutes of implementation and within the first $5-$10 only if infrastructure is billable and spending is separately authorized. If that proof is unavailable, use NMC² + NVIDIA. This is a planning bound, not evidence that the spike has run; this documentation pass creates no account and spends nothing.

## Career-first alternatives

- **T-Mobile + NVIDIA:** best career-first full pivot only if a sponsor representative confirms special handling or eligibility for a high-school Class of 2028 participant. T-Mobile promises every member of a top-three team an internship interview opportunity, not an offer. Its ordinary internship page describes a college-oriented program. This pivot would require a customer-facing scam/fraud product with detection-quality evidence, safeguards, clear next steps, honest confidence, and privacy-by-design.
- **EOG:** best full pivot for the user's planning-research signature. Its challenge asks teams to identify failures, predict time-to-worsening, and select the lowest-cost path to keep operations running. This maps well to verifier-derived cost-to-go rewards, but it requires new industrial telemetry, failure forecasting, and cost models.
- **Winstead:** closest cyber brief, but the current checkpoint does not implement the required independently secure dashboard, encrypted-at-rest keys, administrator identity enrollment, incident-entry UI, or real-time operator interface. Do not claim that the current build is fully secure or already qualifies.

No full pivot is approved in this documentation pass.

## Slide evidence and certainty

| Sponsor | Deck pages | Slide facts | Planning inference / gap |
| --- | ---: | --- | --- |
| T-Mobile | 15-16 | Scam/fraud protection; synthetic data; safeguards and customer experience beyond classification; top three teams receive gear and every winning member gets an internship interview opportunity | Strong career outcome, but ordinary program eligibility appears college-oriented and must be confirmed; substantial customer-product pivot |
| PNC | 19-22 | AI financial-health navigator across accounts and obligations; conversational coach, assessment indicators, forecasts, or what-if simulation; careers QR | Requires financial aggregation/advice UX and guardrails; no winner hiring promise shown |
| 8090.AI | 25 | Agents/tools for understanding, improving, or replacing legacy systems | Agent theme fits, but current app does not analyze or modernize legacy code |
| Toyota Financial Services | 28-31 | Personalized next-move assistant using simulated customer, vehicle, loan, or lease data; responsible AI; 35 software-engineering interns for summer 2027 | Strong employer lead, but the slide gives no winner promise or eligibility; Toyota's student page is university/18+ oriented |
| NMC² | 34-36 | Compute, talent, strategy; infrastructure/software engineering; data-center teams must stay ahead of warnings and handoff failures | Best reuse and conversation fit; career invitation on page 35 is not a job or winner promise |
| Winstead | 39 | Isolated cyber incident-response command center; access control, documentation, scope, real-time communications; security/ease-of-use judging | Closest cyber problem, but current missing UI, admin identity, and at-rest protection are material |
| EOG | 42 | Identify failure, predict time before worsening, find lowest-cost path to prevent shutdown | Best algorithm/research pivot; new domain model required |
| Goldman Sachs | 45-46 | DealPilot commercial-loan lifecycle automation and cross-deal fraud detection | Large finance/workflow/fraud pivot; no hiring promise shown |
| Spacetime | 49-50 | Main track requires Spacetime to power primary functionality; public GitHub required; separate ScrabbleBot tournament | Thin adapter is insufficient; re-platforming the tested core is high risk |
| CBRE | 53-54 | Connect fragmented real-estate data to predict operational failures, quantify business impact, or execute solutions before disruption spreads; Summer 2027 Technology Internship applications reopened specifically for HackUTD | Technically close, but reliable real-estate data integration and prediction are new work; strong recruiting lead with unknown eligibility |
| State Farm | 57 | Intelligent catastrophe response at scale: identify the most urgent needs, coordinate help, and ensure nobody is overlooked | Human-impact fit, but requires disaster intake, prioritization/fairness evidence, and large-scale coordination rather than the existing cyber fixture |
| Capital One | 61 | Best use of Nessie: reimagine banking; each winning member receives a $300 gift card | Broad brief but requires a meaningful Nessie-powered banking product; current app has no banking domain |
| NVIDIA | 64 | Use Nemotron beyond a chatbot with multi-step workflows, tool integration, and real-world applicability | Strong compatibility with bounded agent/tool flow; still needs a real Nemotron integration and does not provide an internship promise |
| Photon | 67-68 | Extensive Photon API use and a real human-in-the-loop interaction are required; mere alerting is insufficient; winner fast-tracks to a final interview round | Best second entry if round trip and eligibility are proven; role and eligibility remain unspecified |

The organizer slides also emphasize understandable design, demo appeal/virality, beginner support, and hardware opportunities. Page 116 defines the beginner track as a majority first-time team (three beginners among four hackers). Page 119 lists HARP-requestable Meta Quest, Meta Glasses, Raspberry Pi Touch Display, and Hiwonder xArm 1S hardware; availability is not guaranteed. Treat design and virality prizes as optional presentation goals: build the smallest functional operator surface needed to enter an incident, review evidence, converse through Photon, and show approval state. Avoid broad UI polish.

MLH extras on pages 84-92 are Tiger Data/Postgres, Solana, an AI A-team using Cursor and Grok Bot, GoDaddy Registry, Vultr, MongoDB Atlas, Gemini API, and the DEV writing challenge. Do not migrate the stable database to a new database, blockchain, or cloud solely for an extra prize. Gemini is relevant only if selected as the bounded model adapter. A DEV write-up and optional low-cost domain are low-risk after the core submission; neither improves technical judging by itself.

## Recruiting facts that need confirmation

- NMC² internship posting: <https://nmc2.com/jobs/nmc2-internship-program-r13380/>. It lists an August 2027-August 2028 graduation range; high-school eligibility is unclear.
- Toyota student careers: <https://careers.toyota.com/us/en/students>. The ordinary program is university/18+ oriented.
- T-Mobile internships: <https://careers.t-mobile.com/internship?keyword=internship>. The ordinary program is college-oriented.
- NVIDIA university recruiting: <https://www.nvidia.com/en-gb/about-nvidia/careers/university-recruiting/>. Do not infer a high-school exception.
- CBRE and Photon eligibility are not established by the deck. Ask sponsor representatives before describing either path as attainable.

Career-priority conversations are: visit CBRE about the reopened application without needing a CBRE entry; ask Photon about role and high-school eligibility; use NMC² mentors for technical and career feedback while recognizing its posted graduation window; ask T-Mobile whether its all-top-three interview promise has a Class of 2028 exception. Treat NVIDIA as portfolio and mentorship value, not an internship promise.

## Official event timing and unresolved rules

Use the opening deck's event schedule for submission planning:

- official build window is Saturday 12:00 through Sunday 12:00 Chicago time;
- Devpost **registration**: Saturday 23:00 (page 106);
- final submission: Sunday 12:00 (page 108);
- judging: Sunday 13:00-16:00 (page 105).

These times are confirmed by the public [schedule](https://hackutd-2026.notion.site/Schedule-3bd63cec77408027986afdc7a2b6d4a4?pvs=25), which warns that timing can change and directs participants to Discord. They supersede the earlier 10:00-10:00 estimate. They do not change the completed 08:00 backend checkpoint or its history. The Spacetime slide lists a 22:45 Saturday tournament, while its web reference reportedly said 23:00; plan for the earlier 22:45 time until confirmed.

The deck and current public [Sponsor Tracks page](https://hackutd-2026.notion.site/Sponsor-Tracks-3bd63cec7740808c9e89e4e25cee23e7?pvs=25) do not settle pre-existing-code/AI rules, project judging weights, or a grand-prize twist. The lead directly observed the public [Zero Day company-tracks site](https://zeroday.hackutd.co/) state “Enter up to two.” The PDF is silent, and the observed wording does not explain whether general or MLH entries count toward that limit, so confirm scope with organizers. Preserve and disclose pre-window code provenance; do not claim that existing work is either approved or disqualified without an official answer.

The public [Points Guide](https://hackutd-2026.notion.site/Points-Guide-3bd63cec774080c9b8b9fffbf5cf542a?pvs=25) describes participation points (workshops, check-in, meals, fun events, and CTF categories) and prize costs. It is not project-judging scoring and should not be described as a grading advantage. It says no points are awarded for events after Sunday 02:00; it does not establish a prize-redemption deadline. For T-Mobile, follow the newer deck instruction to create synthetic scam data rather than depending on the public page's mention of a provided baseline set.
