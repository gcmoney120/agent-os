# Agent OS

A governed multi-agent execution engine. Five specialist AI agents build software together under a written constitution, with human approval gates on anything that matters.

The premise is that the hard part of building with AI agents is not getting them to write code. It is stopping them quietly doing something you did not sanction, losing the thread between sessions, or claiming a piece of work is finished when it is not. Agent OS is the governance layer that solves those three problems.

---

## The problem

Give a capable agent a large task and three things tend to go wrong.

**Scope drifts.** It fixes the bug you asked for and refactors four files you did not mention.

**Context evaporates.** The session fills up, quality degrades, and the next session starts from nothing.

**Completion is asserted, not proven.** "Done" arrives with no evidence that it actually works.

Agent OS answers each of those with structure rather than trust. Authority is separated across agents so no single one can both define and approve its own work. State lives in governed files rather than in a context window. Nothing closes without evidence mapped to acceptance criteria.

---

## The five agents

| Agent | Role | Explicitly cannot |
|---|---|---|
| **Command** | Governing orchestrator. Converts intent into sequenced work, dispatches agents, makes rulings, keeps the principal informed. | Write production code |
| **Atlas** | Architecture. Defines structure, state models, trust boundaries, interface contracts, slice scope and acceptance criteria. | Implement, or close a slice |
| **Forge** | Implementation. Turns approved architecture into code, tests and migrations. | Redefine scope or interpret intent beyond the approved contract |
| **Sentinel** | Security and trust review. Judges whether a change weakens security, audit integrity, authority separation or data safety. | Approve releases, or review style |
| **Compass** | Validation and completeness review. Determines whether the delivered slice actually satisfies the contract. | Own architecture or act as primary security reviewer |

The separation is the point. Atlas defines what must be true. Forge makes it true. Compass checks whether it is actually true in the repository. Sentinel checks whether making it true broke anything that was protecting you. Command rules, and the human principal holds final authority throughout.

---

## How work flows

Work is organised into **slices**: bounded units with explicit scope, explicit exclusions, and numbered acceptance criteria that can be tested.

```
Intent
  │
  ├─ /plan            Command assesses scope, subsystems touched, complexity
  │
  ├─ /activate-slice  Slice becomes the single active unit of work
  │
  ├─ Atlas            Architecture, contracts, acceptance criteria
  │                   ↓ human approval gate
  ├─ Forge            Implementation against the approved contract
  │
  ├─ Sentinel         Trust and security review
  ├─ Compass          Contract and completeness review
  │                   ↓ human approval gate
  └─ /close-slice     Evidence recorded, decision logged, slice retired
```

An **Express** path exists for administrative and low-risk work, so documentation edits do not attract the full ceremony. Anything touching identity, permissions, audit records or trust boundaries never takes it.

---

## The control plane

System state lives in governed files under `.claude/docs/ops/`, not in an agent's memory. Every file has a declared class, an owner, and a write rule.

| Class | Meaning |
|---|---|
| `CLASS_A_LIVE` | Current state. Overwritten in place |
| `CLASS_A_PENDING` | An agent's proposal, awaiting a Command ruling |
| `CLASS_B_APPEND` | Append-only history. Decision log, slice ledger, audit log |
| `CLASS_B_ARCHIVE` | Write-once record, sealed after slice closure |

Two consequences fall out of this. An agent proposal never becomes authoritative until Command issues a ruling recorded in the decision log, so nothing is operative by accident. And the audit log is append-only, so a mistake is corrected by a later entry rather than by editing history.

---

## Memory engine

Persistent memory across sessions, split into three lanes with different retention rules.

- **Episodic.** What happened in a given run: inputs, outputs, stop conditions, outcome. Permanent, append-only, never corrected in place.
- **Semantic.** Knowledge distilled from episodic records: architectural decisions, resolved ambiguities, known constraints. Versioned, with provenance back to the source run and a confidence score. Superseded facts are retired, not deleted.
- **Decision.** Governance rulings, with authority class and binding scope.

Retrieval runs over vector search, keyword search, and a hybrid ranking of the two, with pagination and query guards.

One hard invariant governs the whole subsystem: **a memory artifact that contradicts a governance rule is silently invalid.** Retrieval will never surface remembered context as authoritative over a current governance binding. Memory informs the agents. It does not govern them.

---

## Session chaining

Context windows fill up, and quality degrades well before they do. So at around 60% utilisation, Command writes a handoff and spawns a successor session automatically, without being asked.

```
Session 1  ──handoff──▶  Session 2  ──handoff──▶  Session 3
 boot                     resume                   resume
 execute                  execute                  execute
 handoff                  handoff                  COMPLETE
```

The successor reads the chain context, validates it against the governed state files, and continues. Where the two disagree, governed state wins. Chaining is explicitly a transport layer: it moves work between sessions and bypasses no gate, review or authority boundary. An extra session is cheap. Degraded context is not.

---

## Relay

Runs can be exported as a bundle with a manifest, SHA-256 hashes for every file, and named review targets, then imported elsewhere. This allows a run to be paused on one machine, reviewed or approved somewhere else, and resumed without losing verifiable continuity.

---

## Layout

```
src/
├── runtime/          orchestrator, agent runners, provider adapters
│   ├── runners/      one per agent, plus supabase-migration and vercel-deploy
│   └── providers-*   Anthropic, Supabase, in-memory
├── planner/          dispatch engine, readiness gate, execution loop, run ledger
├── dispatcher/       run dispatch, step verification, error taxonomy
├── memory/           lanes, embeddings, vector and hybrid search, ingestion
├── relay/            export, import, manifests, hashing
├── step-report/      schema, validation, writing
├── approval/         approval artifacts
├── server/           API layer and key auth
└── adapter/          project adapter loading

.claude/
├── docs/agents/      the five agent definitions
├── docs/governance/  control plane operating model
├── docs/ops/         governed state files and audit log
└── commands/         slash commands for planning, dispatch, review, handoff
```

---

## Running it

Requires Node 20+.

```bash
npm install
npm test                  # 37 test suites, Node's built-in runner via tsx
npx tsx src/cli.ts validate
```

The CLI covers project validation, step reports, and relay export, import, approve and resume.

---

## Status and provenance

Version 0.1.0, in active use as the framework I build my own projects with.

It was extracted from the PestFree NZ repository, where it grew while I was building that platform. The governance rules were not designed in the abstract. Each one exists because something went wrong once and I did not want it to happen again.

---

## Built with

TypeScript, Node test runner, tsx, Supabase, Anthropic API, Vercel
