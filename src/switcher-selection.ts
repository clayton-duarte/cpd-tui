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
