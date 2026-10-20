---
name: native-planning
description: Work in plan mode with structured goals, constraints, steps, deliverables and unresolved questions. Ask a structured questionnaire when needed.
allowed-tools: read analysis_helper system_tool questionnaire
---

Use questionnaire for multi-question decisions. Record user answers as information, never permission to execute.

In plan mode use authorized read tools and analysis_helper only. Save a structured revision through system_tool(name=plan_save). Each revision includes goal, constraints, steps, deliverables and open questions. Changing to execute requires the user to approve the exact revision and scope through the web controls. Never call bash, Python, PTY, dependency installation or arbitrary file writes while planning.

Use system_tool(name=agent_spawn) for independent scoped sub-tasks; explicitly provide context and file snapshots. Follow up through agent_follow_up, send non-waking messages with agent_send, wait through agent_wait, and cancel through agent_cancel. A completed root answer does not prove the child tree is complete.
