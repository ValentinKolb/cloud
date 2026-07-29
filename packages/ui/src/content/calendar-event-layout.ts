export type CalendarIntervalLayout<T> = {
  item: T;
  lane: number;
  lanes: number;
  groupId: number;
  groupStart: number;
  groupEnd: number;
};

type BoundedItem<T> = {
  item: T;
  start: number;
  end: number;
};

type ActiveLane = {
  end: number;
  lane: number;
};

const heapPush = <T>(heap: T[], value: T, before: (left: T, right: T) => boolean): void => {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!before(heap[index]!, heap[parent]!)) break;
    [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
    index = parent;
  }
};

const heapPop = <T>(heap: T[], before: (left: T, right: T) => boolean): T | undefined => {
  const first = heap[0];
  const last = heap.pop();
  if (heap.length === 0 || last === undefined) return first;
  heap[0] = last;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let next = index;
    if (left < heap.length && before(heap[left]!, heap[next]!)) next = left;
    if (right < heap.length && before(heap[right]!, heap[next]!)) next = right;
    if (next === index) return first;
    [heap[index], heap[next]] = [heap[next]!, heap[index]!];
    index = next;
  }
};

const layoutGroup = <T>(
  group: readonly BoundedItem<T>[],
  groupId: number,
): CalendarIntervalLayout<T>[] => {
  const active: ActiveLane[] = [];
  const freeLanes: number[] = [];
  const assigned: Array<{ item: T; lane: number }> = [];
  let laneCount = 0;

  for (const entry of group) {
    while (active[0] && active[0].end <= entry.start) {
      const released = heapPop(active, (left, right) => left.end < right.end || (left.end === right.end && left.lane < right.lane));
      if (released) heapPush(freeLanes, released.lane, (left, right) => left < right);
    }
    const lane = heapPop(freeLanes, (left, right) => left < right) ?? laneCount++;
    heapPush(active, { end: entry.end, lane }, (left, right) => left.end < right.end || (left.end === right.end && left.lane < right.lane));
    assigned.push({ item: entry.item, lane });
  }

  const groupStart = group[0]?.start ?? 0;
  const groupEnd = group.reduce((latest, entry) => Math.max(latest, entry.end), groupStart);
  return assigned.map(({ item, lane }) => ({ item, lane, lanes: Math.max(1, laneCount), groupId, groupStart, groupEnd }));
};

/**
 * Assigns the lowest available visual lane to overlapping intervals.
 * Sorting plus two binary heaps keeps large overlap groups at O(n log n).
 */
export const layoutCalendarIntervals = <T>(
  items: readonly T[],
  bounds: (item: T) => { start: number; end: number },
): CalendarIntervalLayout<T>[] => {
  const sorted = items
    .map((item) => {
      const interval = bounds(item);
      return { item, start: interval.start, end: Math.max(interval.start, interval.end) };
    })
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const groups: Array<Array<BoundedItem<T>>> = [];
  let group: Array<BoundedItem<T>> = [];
  let groupEnd = Number.NEGATIVE_INFINITY;

  for (const entry of sorted) {
    if (group.length === 0 || entry.start < groupEnd) {
      group.push(entry);
      groupEnd = Math.max(groupEnd, entry.end);
      continue;
    }
    groups.push(group);
    group = [entry];
    groupEnd = entry.end;
  }
  if (group.length > 0) groups.push(group);

  return groups.flatMap((entries, groupId) => layoutGroup(entries, groupId));
};
