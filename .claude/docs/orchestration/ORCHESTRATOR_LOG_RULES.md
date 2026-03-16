# Orchestrator Log Rules
# RUN ENVELOPE STANDARD

Every orchestrated execution MUST follow this envelope structure.

## run_id format

YYYYMMDD-HHMM-<slice_id>-<shortid>

Example:
20260224-2035-slice1_init-a7f3

- slice_id must match the Slice Packet identifier exactly.
- shortid is a 4–6 character random alphanumeric string.

## Required Log Sequence

Each run MUST contain the following event order:

1. run.start
2. agent.request (one or more)
3. agent.response (paired to each request)
4. run.end

No execution is considered valid unless:
- A single run.start exists.
- A single run.end exists.
- Every agent.request has a matching agent.response.
- All events share the same run_id.

## Event Types

Allowed event types:

- run.start
- agent.request
- agent.response
- run.end
- run.error (only if execution aborts)

## Stream Discipline

- stdout is reserved strictly for MCP protocol.
- All human-readable logs MUST go to stderr.
- ORCHESTRATOR_LOG.ndjson must contain only structured JSON events.

Any deviation invalidates the run.
## File
/ops/ORCHESTRATOR_LOG.ndjson

## Format
- NDJSON (one JSON object per line)
- Append-only

## Required fields per entry
- ts (ISO timestamp)
- run_id (string)
- actor ("Foreman" | "atlas" | "forge" | "sentinel" | "compass")
- action (string)
- slice_id (string)
- input_ref (string | null)
- output_ref (string | null)
- status ("ok" | "error" | "blocked")
- notes (string)

## Non-negotiable
- Never delete or edit prior lines.
- If a mistake occurs: append a correction entry referencing the prior line.