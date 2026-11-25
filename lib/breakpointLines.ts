/**
 * Keep breakpoints on the same code while the program is edited.
 *
 * Breakpoints are stored as 1-based line numbers. An edit changes one block of lines: the
 * lines before it and after it are unchanged. Breakpoints before the block stay, breakpoints
 * after it move by the number of lines added or removed, and a breakpoint inside the block
 * stays on its line number only if that line still exists in the edited block.
 */
export function moveBreakpointLines(
  before: string,
  after: string,
  breakpoints: ReadonlySet<number>,
): Set<number> {
  if (breakpoints.size === 0 || before === after) return new Set(breakpoints);
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const shortest = Math.min(oldLines.length, newLines.length);

  let same = 0;
  while (same < shortest && oldLines[same] === newLines[same]) same += 1;
  let sameAtEnd = 0;
  while (
    sameAtEnd < shortest - same &&
    oldLines[oldLines.length - 1 - sameAtEnd] === newLines[newLines.length - 1 - sameAtEnd]
  ) {
    sameAtEnd += 1;
  }

  const oldBlockEnd = oldLines.length - sameAtEnd;
  const newBlockEnd = newLines.length - sameAtEnd;
  const shift = newLines.length - oldLines.length;
  const moved = new Set<number>();
  for (const line of breakpoints) {
    if (line <= same) moved.add(line);
    else if (line > oldBlockEnd) moved.add(line + shift);
    else if (line <= newBlockEnd) moved.add(line);
  }
  return moved;
}
