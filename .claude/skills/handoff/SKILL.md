---
name: "handoff"
description: "Wrap up the current session: summarize what changed since the last handoff and update NOTE.md (status, recent updates, open ideas, known issues), keeping it around the requested number of lines. Use when the user runs /handoff or asks to wrap up or hand off."
---

Wrap up the work done since the last handoff and record it in NOTE.md at the project root. Keep NOTE.md around $0 lines (if no number was given, use 100). The limit is soft: going 5–10% over is fine.

### Rules

- Only edit NOTE.md. Do not modify CLAUDE.md (it changes only when the user explicitly asks), and change no other file.
- NOTE.md is committed to the public repository: never write API keys, email addresses or other personal details into it.
- Report facts, not plans you haven't agreed with the user. Mark untested things as untested.

### Steps

1. Read NOTE.md and CLAUDE.md. Note the "Last updated" date in NOTE.md.
2. Collect what changed since then:
   - this conversation: features built, bugs fixed, decisions the user made, ideas offered but not decided, things tested and how;
   - `git log --oneline --since=<last updated date>` and `git status --short` for commits and uncommitted work;
   - if anything is unclear, read the changed files rather than guessing.
3. Update NOTE.md, keeping its sections:
   - **Last updated:** today's date.
   - **Current status:** rewrite to describe the project as it is now (what works, what is untested, repository state). Replace outdated statements; don't append.
   - **Recent updates:** add a dated entry at the top with short bullets. Group related changes under one heading.
   - **Open ideas:** remove items that were done or rejected, add new ones offered this session, and update ones the user decided on.
   - **Known issues and limitations:** add new ones, remove fixed ones.
   - **Testing notes:** update only if the testing approach changed.
4. Keep the length near the target. If it is too long, condense the oldest "Recent updates" entries first: merge them into one short summary line per day or topic, keeping key decisions. Never silently drop open ideas or known issues; shorten their wording instead.
5. Tell the user, in a few lines, what you changed in NOTE.md and its new line count. Don't commit or push unless the user asks.
