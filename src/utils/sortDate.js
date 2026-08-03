export function createUtcSortDate(
  baseDate = new Date(),
  offsetMilliseconds = 0,
) {
  const date =
    baseDate instanceof Date
      ? baseDate
      : new Date(baseDate);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid base date.");
  }

  return new Date(
    date.getTime() + offsetMilliseconds,
  ).toISOString();
}

export function getMovedItemSortDatetime({
  previousItem,
  nextItem,
  gapMilliseconds = 1000,
}) {
  const previousTime = previousItem?.sortDatetime
    ? new Date(previousItem.sortDatetime).getTime()
    : null;

  const nextTime = nextItem?.sortDatetime
    ? new Date(nextItem.sortDatetime).getTime()
    : null;

  // Move to the first position.
  if (previousTime == null && nextTime != null) {
    return new Date(
      nextTime - gapMilliseconds,
    ).toISOString();
  }

  // Move to the last position.
  if (previousTime != null && nextTime == null) {
    return new Date(
      previousTime + gapMilliseconds,
    ).toISOString();
  }

  // Only one item exists.
  if (previousTime == null && nextTime == null) {
    return new Date().toISOString();
  }

  const difference = nextTime - previousTime;

  /*
   * There must be enough space between the two timestamps.
   * With JavaScript Date, timestamp precision is milliseconds.
   */
  if (difference <= 1) {
    throw new Error(
      "There is not enough timestamp space between adjacent plans. Rebalancing is required.",
    );
  }

  return new Date(
    previousTime + Math.floor(difference / 2),
  ).toISOString();
}