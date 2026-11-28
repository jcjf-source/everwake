# Task G08 — Battle scene

## Objective
Replace on-map combat with battle scenes: an enemy that reaches you starts a battle, which is played in its own scene using the rules from G07. See `EXPEDITION_DECK.md` §5.1 and §5.4.

## Scope
- **Trigger:** in the enemy reaction, a hunting enemy that would attack or charge the player starts a battle instead of striking. Every hunting enemy within 2 hexes joins in. Set `interrupt: { reason: 'battle' }` so travel stops. Store the battle on `game.battle`. While a battle is running, the pipeline accepts only battle actions.
- **Battle actions** through the existing pipeline: `battlePlay { card }` and `battleBasic { kind, target? }`. Each is one turn (README, decision 8) and costs no stride. The world's enemy reaction doesn't run during a battle: the battle's own enemy step does.
- **Scene** (`src/render/battleArt.js`, `src/ui/battlePanel.js`): draw the arena with the existing hex and terrain renderers at a fixed zoom. Show the player and enemy figures (reuse `enemyArt`), an intent marker and health on each enemy, and the 3-card hand plus the basic actions. Tapping an arena hex selects targets for Step, Lunge and Strike. Taps must not reach the world map behind it.
- **After a battle:** you go back to the world hex where it started. Defeated enemies are removed (`enemies.kill`) and their loot is added. After fleeing, the enemies switch to `returning`. A defeat uses the existing defeat flow (the expedition ends, the pack is lost, the sanctuary screen opens).
- **Remove Task 10's on-map combat:** the `attack`, `defend` and world `flee` actions, the Attack, Defend and Flee buttons in the context row, and parting strikes. Keep `use` on the world map. Update `contextActions`, `combatText`, the docs and tests. Delete or rewrite the tests that only covered on-map combat, and say which ones in the report.
- **Save:** `game.battle` is saved, so a reload resumes the battle (README, decision 12). Validate it.
- Report: the expedition tally counts battles won and fled.

## Acceptance
An enemy reaching you starts a battle on the right arena, and travel stops. Playing a battle to a win, a flee and a defeat each returns to the world in the correct state. Enemies avoided by routing around them never start a battle. Battle turns cost no stride. A reload mid-battle resumes it. The scene works at the four viewports with touch and keyboard. The browser check has a battle flow, and all tests pass.
