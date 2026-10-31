# AI logs

One Markdown file per AI session, named `YYYY-MM-DD-<name>-<topic>.md`.
Paste the prompts word for word. Link or paste the outputs, and attach screenshots if the tool cannot export.

These files are the evidence for the AI Audit Report:
- **Section 3** (prompt logs) quotes the prompts.
- **Section 5** (problems and vulnerabilities) points to what the AI got wrong and how we found it.

## Template

```markdown
# <topic>

- **Date:**
- **Member:**
- **Tool:** (Claude, Cursor, Copilot, ChatGPT ...)
- **Goal:** what we wanted from this session

## Prompts
1. "..."
2. "..."

## What the AI produced
Files or code it generated, with links to commits.

## What we checked or changed
- Problems found in the output (wrong logic, security issues, missing checks)
- What we kept, what we rewrote and why

## Evidence
Test output, Slither results, screenshots.
```
