/**
 * Choose which session id should remain selected after the session list
 * reorders. Selection is tracked by session id, never by row index, because
 * pi appends to session files constantly and rows reorder under the cursor.
 *
 * - If `selectedId` is still present in `orderedIds`, keep it.
 * - Otherwise (including the very first render where `selectedId` is null)
 *   fall back to the first id in the list.
 * - An empty list has nothing to select.
 */
export function preserveSelectionById(
  selectedId: string | null,
  orderedIds: readonly string[],
): string | null {
  if (orderedIds.length === 0) return null;
  if (selectedId !== null && orderedIds.includes(selectedId)) return selectedId;
  return orderedIds[0]!;
}

/**
 * Choose which session id should become selected right after deleting the
 * currently-selected one. Moves to the row immediately ABOVE the deleted
 * one's old position, so the cursor lands on the thing the user was just
 * looking near rather than jumping forward past it.
 *
 * - `beforeIds` is the ordered id list *before* the delete (includes the
 *   deleted id); `afterIds` is the ordered id list *after* the delete.
 * - If a previous row existed (deletedIndex > 0), select the id that was
 *   immediately above it in `beforeIds`, resolved against `afterIds` (it
 *   can't have been deleted, so it is always still present there).
 * - If the deleted row was the FIRST row, there is no previous row: fall
 *   forward to the new first row.
 * - If the deleted id wasn't in `beforeIds` at all, fall back to the first
 *   row (defensive).
 * - Empty `afterIds` has nothing to select.
 */
export function selectionAfterDeletion(
  deletedId: string,
  beforeIds: readonly string[],
  afterIds: readonly string[],
): string | null {
  if (afterIds.length === 0) return null;
  const deletedIndex = beforeIds.indexOf(deletedId);
  if (deletedIndex === -1) {
    // Deleted id wasn't even in the before-list; nothing meaningful to
    // anchor on, keep it simple and pick the first row.
    return afterIds[0]!;
  }
  if (deletedIndex === 0) {
    // No previous row exists; fall forward to the new first row.
    return afterIds[0]!;
  }
  return beforeIds[deletedIndex - 1]!;
}
