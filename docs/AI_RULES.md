# EVERWAKE — AI Development Rules

These instructions apply whenever an AI coding agent works in this repository.


## Before editing
1. Inspect the repository and existing code before making changes.
2. Read `docs/GAME_DESIGN.md`, `docs/ROADMAP.md`, `docs/TECHNICAL.md`, this file, and the selected task.
3. Identify current architecture and the smallest safe implementation path.
4. If the repository differs from the docs, report the discrepancy and reconcile carefully; do not blindly overwrite.

## Scope discipline
- Implement only the selected task and its necessary dependencies.
- Do not start later tasks automatically.
- Do not rewrite the project to implement a small feature.
- Do not remove working features or change established design decisions without explaining the need and asking for approval for significant changes.
- Do not add dependencies without a clear reason; explain and seek approval for major dependencies.
- Avoid placeholder or fake behavior for features in scope. If a feature must be deferred, clearly label it and report it.
- No real-time movement or idle world simulation; game simulation advances only through player actions.
- No square-grid substitute: movement and world navigation use hexes.
- No WASD requirement: click/tap is the primary movement input.

## Code quality
- Keep systems modular and appropriately sized.
- Separate simulation logic from rendering and UI.
- Prefer clear names and straightforward implementations over clever abstractions.
- Avoid duplicate sources of truth for state.
- Validate actions and inputs. Invalid actions should not consume turns.
- Ensure all visible controls do what they claim.
- Consider mobile touch interaction and responsive layout.
- Avoid emoji as primary game-world art.

## Testing and verification
- Run the project's existing test, lint, and build commands where available.
- Add targeted tests for logic introduced or changed.
- Test behavior manually in a browser when appropriate; state exactly what was and wasn't tested.
- Check console errors and regressions in existing functionality.
- Never claim a test passed if it was not run.

## Documentation
After a completed task, update as applicable:
- `docs/ROADMAP.md` task status
- `docs/TECHNICAL.md` architecture/decisions
- `docs/CHANGELOG.md` summary
If docs are not present yet, create them only as part of project setup or ask before expanding scope.

## Reporting
At task completion, report:
1. What changed.
2. Files added/modified.
3. Tests/checks actually run and their results.
4. How the user can manually verify it.
5. Known limitations or follow-up work.
6. Confirm that no subsequent task was started.

Stop after the selected task. Do not ask the user to approve routine implementation details; do ask before destructive changes, major architecture changes, or broad scope expansion.
