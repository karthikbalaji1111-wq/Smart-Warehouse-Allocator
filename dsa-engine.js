/* =========================================================================
   DSA ENGINE  —  Smart Warehouse Storage Allocator
   =========================================================================
   This file is the ONLY place the algorithm lives. It has no knowledge of
   the DOM, CSS, or animation. It contains exactly the three DSA concepts
   used by this project:

       1. ARRAY   — warehouse slots, a plain contiguous JS array
       2. GREEDY  — best-fit scoring, one locally-best decision per product
       3. HEAP    — a hand-written array-based MAX-HEAP (heapInsert,
                    siftDown, heapExtractMax) — no library, no heapq

   allocateProduct() runs the real algorithm exactly once and returns a
   TRACE: an ordered list of events that actually happened during that run
   (which slots were checked, every heap snapshot, the extraction, the
   final allocation). The UI layer only ever replays this trace — it never
   re-implements or fakes any part of the decision.
   ========================================================================= */

(function (global) {
  "use strict";

  // -----------------------------------------------------------------------
  // 1. ARRAY — the warehouse
  // -----------------------------------------------------------------------

  function initialWarehouse() {
    return [
      { id: "S1", capacity: 100, occupied: 0 },
      { id: "S2", capacity: 50, occupied: 0 },
      { id: "S3", capacity: 75, occupied: 0 },
      { id: "S4", capacity: 120, occupied: 0 },
      { id: "S5", capacity: 60, occupied: 0 },
    ];
  }

  // -----------------------------------------------------------------------
  // 2. GREEDY — best-fit scoring for a single (slot, product) pair
  // -----------------------------------------------------------------------

  function calculateScore(slot, product) {
    const available = slot.capacity - slot.occupied;
    if (available < product.requiredSpace) {
      return null; // infeasible — cannot be a candidate
    }
    const leftover = available - product.requiredSpace;
    return -leftover; // higher score = smaller leftover = better fit
  }

  // -----------------------------------------------------------------------
  // 3. HEAP — manual array-based max-heap
  // -----------------------------------------------------------------------
  // Heap entries: { score, slotIndex }
  // Ordering: higher score wins; on a tie, the LOWER slotIndex wins.

  function entryIsGreater(a, b) {
    if (a.score !== b.score) return a.score > b.score;
    return a.slotIndex < b.slotIndex;
  }

  function heapInsert(heap, entry) {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (entryIsGreater(heap[i], heap[parent])) {
        [heap[i], heap[parent]] = [heap[parent], heap[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  // siftDown restores heap order downward from index i.
  // `onSwap` (optional) is called after every swap so a caller can record
  // an intermediate snapshot — purely observational, changes no logic.
  function siftDown(heap, i, onSwap) {
    const n = heap.length;
    while (true) {
      let largest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && entryIsGreater(heap[left], heap[largest])) largest = left;
      if (right < n && entryIsGreater(heap[right], heap[largest])) largest = right;
      if (largest === i) break;
      [heap[i], heap[largest]] = [heap[largest], heap[i]];
      if (onSwap) onSwap(i, largest, heap.slice());
      i = largest;
    }
  }

  function heapExtractMax(heap, onSwap) {
    if (heap.length === 0) return null;
    const n = heap.length;
    [heap[0], heap[n - 1]] = [heap[n - 1], heap[0]];
    const max = heap.pop();
    if (onSwap) onSwap(0, n - 1, heap.slice());
    if (heap.length) siftDown(heap, 0, onSwap);
    return max;
  }

  function buildHeap(candidates, onInsert) {
    const heap = [];
    for (const entry of candidates) {
      heapInsert(heap, entry);
      if (onInsert) onInsert(entry, heap.slice());
    }
    return heap;
  }

  // -----------------------------------------------------------------------
  // allocateProduct — runs the real algorithm once, records a full trace
  // -----------------------------------------------------------------------

  let productCounter = 0;
  function nextProductId() {
    productCounter += 1;
    return "P" + productCounter;
  }
  function resetProductCounter() {
    productCounter = 0;
  }

  function allocateProduct(warehouse, product) {
    const events = [];
    const scanRows = [];

    events.push({ type: "PRODUCT_ARRIVES", product });

    // --- STEP: ARRAY SCAN + GREEDY SCORING ---
    warehouse.forEach((slot, slotIndex) => {
      const available = slot.capacity - slot.occupied;
      const score = calculateScore(slot, product);
      const feasible = score !== null;
      const row = {
        slotIndex,
        slotId: slot.id,
        capacity: slot.capacity,
        occupied: slot.occupied,
        available,
        required: product.requiredSpace,
        feasible,
        leftover: feasible ? -score : null,
        score,
      };
      scanRows.push(row);
      events.push({ type: "SLOT_CHECKED", row });
    });

    const candidates = scanRows
      .filter((r) => r.feasible)
      .map((r) => ({ score: r.score, slotIndex: r.slotIndex }));

    events.push({ type: "FEASIBILITY_DONE", count: candidates.length, scanRows });

    if (candidates.length === 0) {
      events.push({ type: "NO_SLOT_AVAILABLE", product });
      return { product, events, scanRows, candidates, success: false };
    }

    events.push({ type: "GREEDY_SCORED", scanRows });

    // --- STEP: BUILD MAX HEAP ---
    const heap = buildHeap(candidates, (entry, snapshot) => {
      events.push({ type: "HEAP_INSERT", entry, heapSnapshot: snapshot });
    });
    events.push({ type: "HEAP_BUILD_DONE", heapSnapshot: heap.slice() });

    // --- STEP: EXTRACT MAX ---
    events.push({ type: "EXTRACT_MAX_START", heapSnapshot: heap.slice() });
    const best = heapExtractMax(heap, (i, j, snapshot) => {
      events.push({ type: "EXTRACT_STEP", swapped: [i, j], heapSnapshot: snapshot });
    });
    events.push({ type: "EXTRACT_DONE", best });

    const chosenRow = scanRows.find((r) => r.slotIndex === best.slotIndex);

    // --- STEP: UPDATE ARRAY ---
    const slot = warehouse[best.slotIndex];
    const before = slot.occupied;
    slot.occupied += product.requiredSpace;
    events.push({
      type: "ALLOCATE_DONE",
      slotId: slot.id,
      slotIndex: best.slotIndex,
      before,
      after: slot.occupied,
      capacity: slot.capacity,
      leftover: chosenRow.leftover,
      required: product.requiredSpace,
    });

    return {
      product,
      events,
      scanRows,
      candidates,
      success: true,
      chosenRow,
      bestEntry: best,
    };
  }

  global.DSAEngine = {
    initialWarehouse,
    calculateScore,
    heapInsert,
    siftDown,
    heapExtractMax,
    buildHeap,
    allocateProduct,
    nextProductId,
    resetProductCounter,
  };
})(window);
