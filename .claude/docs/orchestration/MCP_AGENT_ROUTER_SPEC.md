# MCP Agent Router Specification
Version: 1.0

## Purpose
Provide a controlled tool interface allowing Foreman to coordinate Atlas, Forge, Sentinel, and Compass without manual copy-paste.

Foreman may ONLY communicate with agents through these tools.

---

## Tool 1: atlas.plan

Purpose:
Refine architecture, IA, flows, acceptance criteria.

Input:
{
  slice_packet_path: string,
  specific_questions: string[]
}

Output:
{
  architectural_notes: string,
  risks_identified: string[],
  updated_acceptance_criteria: string[] (optional),
  requires_trust_review: boolean
}

Rules:
- Atlas must NOT produce implementation code.
- Atlas must NOT alter scope.
- Atlas may only clarify or refine within defined scope.

---

## Tool 2: forge.implement

Purpose:
Implement according to Slice Packet + Atlas clarifications.

Input:
{
  slice_packet_path: string,
  architectural_notes: string,
  constraints: string[]
}

Output:
{
  files_modified: string[],
  summary_of_changes: string,
  test_results: string,
  diff_reference: string
}

Rules:
- Forge must not invent requirements.
- Forge must not alter architecture.
- Forge must not expand scope.

---

## Tool 3: sentinel.review

Purpose:
Security and trust audit review.

Input:
{
  diff_reference: string,
  slice_packet_path: string
}

Output:
{
  approval_status: "approved" | "changes_required",
  findings: string[],
  risk_level: "low" | "medium" | "high"
}

Rules:
- Required if trust-sensitive systems touched.
- Foreman must halt if approval_status != approved.

---

## Tool 4: compass.validate

Purpose:
Validate Acceptance Criteria completeness.

Input:
{
  execution_report_path: string,
  slice_packet_path: string
}

Output:
{
  validation_status: "valid" | "incomplete",
  missing_ac: string[],
  edge_cases_found: string[]
}

Rules:
- Must run before slice marked complete.
- Foreman must not finalize if validation_status != valid.

---

## Non-Negotiable Principles

- All agent interactions must be logged.
- No direct file manipulation bypassing Foreman.
- Trust-sensitive changes trigger Trust Change Protocol automatically.
- Foreman is coordinator, not policy maker.