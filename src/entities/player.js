/**
 * The player's expedition state for movement: where they stand and how
 * many movement actions they have taken.
 *
 * `moves` is a placeholder action counter (one per hex entered) until the
 * formal turn system arrives in Task 06. This is expedition state; it is
 * not saved yet (persistence is Task 13).
 */

/** @param {{ q: number, r: number }} position usually the sanctuary */
export function createPlayer(position) {
  return { position: { q: position.q, r: position.r }, moves: 0 };
}
