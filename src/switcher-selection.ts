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
 * currently-selected one. Moves to the "next" row (the one that slides up
 * into the deleted row's position) rather than resetting to the top, so a
 * run of deletions doesn't keep bouncing the cursor back to row 0.
 *
 * - `beforeIds` is the ordered id list *before* the delete (includes the
 *   deleted id); `afterIds` is the ordered id list *after* the delete.
 * - If the deleted id's old index still has a row in `afterIds`, select it
 *   (that's the "next" row sliding up).
 * - Otherwise (the deleted row was last) select the new last row.
 * - Empty `afterIds` has nothing to select.
 */
export function nextSelectionAfterDeletion(
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
  if (deletedIndex < afterIds.length) return afterIds[deletedIndex]!;
  return afterIds[afterIds.length - 1]!;
}
