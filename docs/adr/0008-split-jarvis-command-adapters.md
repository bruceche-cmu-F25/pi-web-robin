# ADR 0008: Split Jarvis command adapters by capability

## Status

Accepted

## Context

The Jarvis state route accepted 23 unrelated POST actions. Read and contact edits, paid research, message delivery, CRM workflow changes, scheduler configuration, templates, reply synchronization, and report export all shared one dispatcher. A caller or maintainer could not infer the side-effect boundary from the URL, and every change increased the authority and dependency fan-out of the same adapter.

## Decision

Keep `/api/robin/jarvis` as the state resource: GET returns the CRM view and PATCH edits one contact. Move commands to capability-scoped adapters:

- `/api/robin/jarvis/research` owns discovery, rescoring, website enrichment, and their stop commands.
- `/api/robin/jarvis/outreach` owns human approval, channel workflow, delivery, reply sync, and undo.
- `/api/robin/jarvis/preferences` owns schedules and message templates.
- `/api/robin/jarvis/report` renders the report on GET and writes the Jarvis.day copy on POST.

`lib/jarvis-api.ts` is the first-party command map. Browser and CLI callers use those paths instead of posting all commands to the state resource. The old catch-all POST interface is removed rather than retained as a second authority boundary.

## Consequences

- Sending email is no longer reachable through the same adapter that starts research or edits templates.
- Route dependencies and unknown-action errors are local to one capability.
- The action payloads remain compatible inside each capability, so domain behavior is unchanged.
- A new command must choose an owning capability; it cannot silently enlarge the state route.
