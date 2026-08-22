# Smart Warehouse Storage Allocator — Presentation Notes

## 1. Problem Statement
A warehouse has a fixed set of storage slots, each with a limited capacity.
Products arrive one at a time and need to be placed into a slot that has
enough free space. Naively picking the *first* slot that fits wastes space
and leaves the warehouse poorly packed. We need a fast, explainable way to
pick a *good* slot for every incoming product.

## 2. Objective
Build a console-based allocator that, for each incoming product:
- Finds every storage slot that can physically hold it.
- Picks the single best one using a simple, greedy, best-fit rule.
- Updates the warehouse state and reports the outcome.

## 3. Why Array
The warehouse's slots are naturally a fixed, indexable collection — a
**list/array** is the simplest structure that lets us scan every slot in
O(n) to check feasibility, and update a chosen slot's occupied space in
O(1) once we know its index.

## 4. Why Heap
For a given product there can be several *valid* slots. We only want the
single best one, repeatedly, as products arrive. A **max-heap** gives us
O(log k) insertion and O(log k) extraction of the best candidate (k =
number of valid slots for that product), which is more principled and
scalable than manually scanning the candidate list for the maximum every
time — and it's the textbook structure for "give me the best item so far,
efficiently."

## 5. How the Greedy Algorithm Works
For each product, the algorithm makes the locally best decision — the
valid slot that leaves the **least leftover space** after the product is
stored (best-fit) — without reconsidering that choice later or looking
ahead at what products will arrive next. That's what makes it greedy
rather than exhaustive/optimal search: it never backtracks.

**Scoring formula:**
```
available   = slot.capacity - slot.occupied
leftover    = available - product.required_space     (only if available >= required_space)
score       = -leftover        # higher score = smaller leftover = better fit
```

**Product ordering:** products are processed in order of their own
`priority` field (highest first). This doesn't change which slot a given
product prefers — it changes *whose turn* comes first, so urgent products
get the pick of the warehouse before lower-priority ones.

## 6. Step-by-Step Algorithm
1. Represent all slots in an array.
2. For each product (processed highest-priority first):
   a. Scan the array; keep slots where `available capacity >= required space`.
   b. Compute a best-fit score for each valid slot.
   c. Insert each `(score, slot)` pair into a max-heap.
   d. Extract the maximum — the best-fitting valid slot.
   e. If no valid slot existed, report "No suitable storage slot available."
   f. Otherwise, update that slot's occupied space.
3. After all products are processed, display the final warehouse state and
   a product → slot summary.

## 7. Example Dry Run
Warehouse: S1(100), S2(50), S3(75), S4(120), S5(60) — all empty.
Products: P1 Laptop/40/priority 2, P2 Chair/55/priority 1,
P3 Monitor/30/priority 3, P4 Server Rack/150/priority 2.

Processing order by priority: **P3 → P1 → P4 → P2**

| Product | Valid slots (leftover space) | Chosen | Why |
|---|---|---|---|
| P3 (30) | S1:70, S2:20, S3:45, S4:90, S5:30 | **S2** | smallest leftover (20) |
| P1 (40) | S1:60, S3:35, S4:80, S5:20 | **S5** | smallest leftover (20) |
| P4 (150) | *(none — exceeds every slot's capacity)* | — | reported as not allocated |
| P2 (55) | S1:45, S3:20, S4:65 | **S3** | smallest leftover (20) |

Final state: S1 untouched (100 free), S2 has 20 free, S3 has 20 free,
S4 untouched (120 free), S5 has 20 free. P4 is correctly reported as
unallocated.

## 8. Time Complexity
Let **n** = number of storage slots, **k** = number of valid slots for a
given product (k ≤ n), **m** = number of products.

| Operation | Complexity |
|---|---|
| Scan array for valid slots (per product) | O(n) |
| heap_insert (single) | O(log k) |
| Building the heap for one product (k inserts) | O(k log k) |
| heap_extract_max | O(log k) |
| Allocating one product (scan + build heap + extract) | O(n + k log k), which is O(n log n) in the worst case (k = n) |
| Whole program (m products) | O(m · n log n) |

## 9. Space Complexity
- Warehouse array: O(n)
- Product list: O(m)
- Heap of candidates (rebuilt per product, discarded after use): O(k), at most O(n)
- Overall: **O(n + m)**

## 10. Limitations
- Best-fit is greedy and locally optimal per product — it does not
  guarantee a globally optimal packing across *all* products (a classic
  bin-packing limitation).
- Doesn't account for real warehouse factors like slot location/distance,
  item weight/fragility, or grouping related items together.
- If a product doesn't fit anywhere, it's simply dropped/reported — there's
  no splitting across multiple slots or waitlisting.

## 11. Possible Future Improvements
- Compare best-fit against other greedy strategies (first-fit, worst-fit)
  on the same input to show trade-offs.
- Allow a product to be released later (freeing slot space) to show
  dynamic reuse over time.
- Add slot-to-slot proximity/location as another scoring factor.
- Explore whether a smarter (non-greedy) allocation could do better on
  adversarial inputs, to motivate more advanced algorithms in future
  coursework.
