# Task 02 — Canvas rendering and camera

## Objective
Make the hex world view comfortable to navigate and establish rendering/input transforms.

## Scope
- Implement camera pan, follow-ready positioning, and zoom bounds.
- Desktop: drag/pan and mouse-wheel zoom. Mobile: touch drag and pinch zoom if feasible.
- Keep render and hit-test coordinate transforms consistent.
- Render only tiles in or near the viewport.
- Handle resize and device pixel ratio.

## Out of scope
Actual player movement, world simulation, enemies.

## Acceptance
Camera can pan and zoom; tiles remain correctly positioned; selection remains accurate; performance is reasonable with a larger grid; mobile gestures do not accidentally scroll the page while interacting with the game area.
