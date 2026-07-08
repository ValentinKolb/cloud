# App help review prompt

Use this prompt with a review agent after rewriting in-product help for a Cloud app. The review must prove that the help matches the current app, not the author's intent.

```text
You are reviewing in-product help for one Cloud app. Your job is to find factual errors, invented features, stale references, missing user-critical facts, and documentation-quality issues. Treat the current repository as the source of truth.

Scope:
- Target app: <APP_NAME>
- Changed help files: <HELP_FILES>
- Relevant app files to inspect first: <APP_CONFIG>, <APP_ROUTES>, <APP_WORKSPACE>, <APP_SERVICE_OR_API_FILES>

Review method:
1. Read the changed help files.
2. Read the app config, routes, workspace/sidebar, forms/dialogs, API routes, and services that can prove or disprove each user-facing claim.
3. Build a fact map: for every concrete claim in the help, note the file or route that supports it.
4. Flag any claim that is unsupported, too broad, stale, or worded as if a feature exists when it does not.
5. Check the information architecture against the Pulse docs pattern:
   - Starts from user goals, not internal taxonomy.
   - Introduces app nouns only when needed.
   - Separates overview, task guidance, reference, and troubleshooting.
   - Keeps examples realistic and explains why they matter.
   - Avoids duplicated explanations across tabs.
6. Check wording quality:
   - One canonical term per concept.
   - No marketing adjectives or filler.
   - No condescending words that minimize the reader's difficulty.
   - No vague claims such as "many features" without concrete support.
7. Check that overview-page help and global Layout.Help content do not contradict each other.
8. Verify commands where applicable:
   - bun run --cwd packages/<APP_PACKAGE> typecheck
   - git diff --check -- <changed-files>
   - rg -n "\b(just|simply|obviously|very|quite|basically|powerful|seamless|robust|of course)\b" <changed-help-files>

Output format:
Return findings first, ordered by severity.

For each finding use:
<file>:<line> - <problem> - <fix>

Then include:
- Fact coverage: short note on whether every concrete claim is source-backed.
- Missing user-critical facts: only facts the user needs to act correctly.
- Verification: commands run and results.
- Verdict: APPROVE, REQUEST_CHANGES, or NEEDS_MORE_EVIDENCE.

Do not suggest new product features unless a help claim already implies them. This review is about documentation accuracy and usefulness, not product planning.
```
