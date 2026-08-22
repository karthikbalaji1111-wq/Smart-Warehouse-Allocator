/* =========================================================================
   UI / VISUALIZATION LOGIC  —  Smart Warehouse Control Center
   =========================================================================
   Everything in this file only READS state produced by DSAEngine and
   renders it. It never recomputes a score, never reorders a heap, never
   decides which slot wins — it replays the exact trace that
   DSAEngine.allocateProduct() already produced.
   ========================================================================= */

(function () {
  "use strict";

  const SAMPLE_PRODUCTS = [
    { name: "Laptop", space: 40 },
    { name: "Chair", space: 55 },
    { name: "Monitor", space: 30 },
    { name: "Server Rack", space: 150 },
  ];

  const PIPELINE_ORDER = ["array", "greedy", "heap", "best", "update"];

  // -------------------------------------------------------------- state --
  const state = {
    warehouse: DSAEngine.initialWarehouse(),
    demoModeOn: false,
    presentationOn: false,
    busy: false,
    currentStages: null,
    currentStageIndex: 0,
    timelineCount: 0,
  };

  // -------------------------------------------------------------- dom ----
  const el = {
    warehouseGrid: document.getElementById("warehouseGrid"),
    productForm: document.getElementById("productForm"),
    productId: document.getElementById("productId"),
    productName: document.getElementById("productName"),
    productSpace: document.getElementById("productSpace"),
    allocateBtn: document.getElementById("allocateBtn"),
    timeline: document.getElementById("timeline"),
    resultCard: document.getElementById("resultCard"),
    greedyTableBody: document.getElementById("greedyTableBody"),
    greedyDecision: document.getElementById("greedyDecision"),
    heapTree: document.getElementById("heapTree"),
    heapArray: document.getElementById("heapArray"),
    pipeline: document.querySelectorAll(".pipeline__stage"),
    demoToggle: document.getElementById("demoToggle"),
    presentationToggle: document.getElementById("presentationToggle"),
    resetBtn: document.getElementById("resetBtn"),
    nextStepBtn: document.getElementById("nextStepBtn"),
    runDemoBtn: document.getElementById("runDemoBtn"),
    presentationSummary: document.getElementById("presentationSummary"),
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ===================================================================
  // Warehouse rendering
  // ===================================================================

  function slotStatus(slot) {
    if (slot.occupied <= 0) return { key: "available", label: "AVAILABLE" };
    if (slot.occupied >= slot.capacity) return { key: "full", label: "FULL" };
    return { key: "partial", label: "PARTIALLY OCCUPIED" };
  }

  // overrides: Map<slotIndex, {key: 'scanning'|'candidate'|'invalid'|'best', label}>
  function renderWarehouse(overrides) {
    overrides = overrides || new Map();
    el.warehouseGrid.innerHTML = state.warehouse
      .map((slot, i) => {
        const pct = Math.min(100, Math.round((slot.occupied / slot.capacity) * 100));
        const available = slot.capacity - slot.occupied;
        const base = slotStatus(slot);
        const ov = overrides.get(i);
        const statusKey = ov ? ov.key : base.key;
        const statusLabel = ov ? ov.label : base.label;
        const fillColor =
          statusKey === "full" ? "var(--alert)" :
          statusKey === "partial" ? "var(--hazard)" :
          statusKey === "best" ? "var(--hazard)" :
          "var(--depot)";
        return `
          <article class="slot-card slot-card--${statusKey}" data-slot="${i}">
            <div class="slot-card__id">${slot.id}</div>
            <div class="slot-card__cap">CAPACITY ${slot.capacity}</div>
            <div class="slot-card__gauge" aria-hidden="true">
              <div class="slot-card__gauge-fill" style="height:${pct}%; background:${fillColor}"></div>
              <div class="slot-card__gauge-ticks"></div>
            </div>
            <div class="slot-card__available">${slot.occupied} used &middot; <b>${available}</b> free</div>
            <div class="slot-card__status">${statusLabel}</div>
          </article>`;
      })
      .join("");
  }

  async function sweepScan(scanRows) {
    const overrides = new Map();
    for (const row of scanRows) {
      overrides.set(row.slotIndex, { key: "scanning", label: "SCANNING…" });
      renderWarehouse(overrides);
      await wait(180);
      overrides.set(
        row.slotIndex,
        row.feasible
          ? { key: "candidate", label: "VALID CANDIDATE" }
          : { key: "invalid", label: "TOO SMALL" }
      );
      renderWarehouse(overrides);
      await wait(90);
    }
    return overrides;
  }

  // ===================================================================
  // Greedy table
  // ===================================================================

  function renderGreedyTable(scanRows, bestSlotIndex) {
    el.greedyTableBody.innerHTML = scanRows
      .map((row) => {
        const isBest = row.slotIndex === bestSlotIndex;
        const cls = !row.feasible ? "is-invalid" : isBest ? "is-best" : "";
        return `
          <tr class="${cls}">
            <td>${row.slotId}</td>
            <td>${row.available}</td>
            <td>${row.required}</td>
            <td>${row.feasible ? row.leftover : "—"}</td>
            <td>${row.feasible ? row.score : "—"}</td>
            <td>${row.feasible ? (isBest ? "BEST" : "VALID") : "INVALID"}</td>
          </tr>`;
      })
      .join("");
  }

  function showGreedyDecision(chosenRow) {
    el.greedyDecision.hidden = false;
    el.greedyDecision.innerHTML = `
      <div class="greedy-decision__label">Greedy Decision</div>
      <div class="greedy-decision__slot">${chosenRow.slotId}</div>
      <div class="greedy-decision__reason">Least leftover = ${chosenRow.leftover} &middot; Score = ${chosenRow.score}</div>`;
  }

  function hideGreedyDecision() {
    el.greedyDecision.hidden = true;
    el.greedyDecision.innerHTML = "";
  }

  // ===================================================================
  // Max-heap visualization (array is the source of truth; tree is a view)
  // ===================================================================

  function nodePos(i) {
    const level = Math.floor(Math.log2(i + 1));
    const levelStart = Math.pow(2, level) - 1;
    const posInLevel = i - levelStart;
    const levelCount = Math.pow(2, level);
    const x = ((posInLevel + 1) / (levelCount + 1)) * 620 + 10;
    const y = 45 + level * 90;
    return { x, y };
  }

  function slotIdFor(slotIndex) {
    return state.warehouse[slotIndex].id;
  }

  function renderHeap(heapSnapshot) {
    const n = heapSnapshot.length;
    let svg = "";

    // edges (right-angle circuit-trace connectors)
    for (let i = 0; i < n; i++) {
      const p = nodePos(i);
      [2 * i + 1, 2 * i + 2].forEach((c) => {
        if (c < n) {
          const cp = nodePos(c);
          const midY = p.y + (cp.y - p.y) / 2;
          svg += `<path d="M ${p.x} ${p.y + 18} V ${midY} H ${cp.x} V ${cp.y - 18}"
                    fill="none" stroke="var(--conduit-bright)" stroke-width="2" />`;
        }
      });
    }

    // nodes
    heapSnapshot.forEach((entry, i) => {
      const p = nodePos(i);
      const isRoot = i === 0;
      const stroke = isRoot ? "var(--hazard)" : "var(--beacon-dim)";
      const textColor = isRoot ? "var(--hazard)" : "var(--fog)";
      svg += `
        <g>
          <rect x="${p.x - 42}" y="${p.y - 18}" width="84" height="36" rx="6"
                fill="var(--panel-raised)" stroke="${stroke}" stroke-width="${isRoot ? 2 : 1.4}" />
          <text x="${p.x}" y="${p.y - 3}" text-anchor="middle" font-size="13" font-weight="600" fill="${textColor}">${slotIdFor(entry.slotIndex)}</text>
          <text x="${p.x}" y="${p.y + 12}" text-anchor="middle" font-size="10" fill="var(--haze)">score ${entry.score}</text>
          <text x="${p.x - 34}" y="${p.y - 22}" text-anchor="start" font-size="9" fill="var(--haze-dim)">[${i}]</text>
        </g>`;
    });

    el.heapTree.innerHTML = svg;

    el.heapArray.innerHTML =
      `<span class="heap-array__label">Underlying array</span>` +
      heapSnapshot
        .map(
          (entry, i) => `
        <span class="heap-cell${i === 0 ? " heap-cell--root" : ""}">
          <span class="heap-cell__idx">${i}</span>(${entry.score}, ${slotIdFor(entry.slotIndex)})
        </span>`
        )
        .join("");
  }

  function clearHeap() {
    el.heapTree.innerHTML = "";
    el.heapArray.innerHTML = "";
  }

  // ===================================================================
  // Timeline
  // ===================================================================

  function addTimelineEntry(num, title, detail, opts) {
    opts = opts || {};
    const li = document.createElement("li");
    li.className = "timeline-entry" + (opts.empty ? " is-empty" : "");
    li.innerHTML = `
      <div class="timeline-entry__head">
        ${num ? `<span class="timeline-entry__num">${num}</span>` : ""}
        <span class="timeline-entry__title">${title}</span>
      </div>
      ${detail ? `<div class="timeline-entry__detail">${detail}</div>` : ""}`;
    el.timeline.appendChild(li);
    el.timeline.scrollTop = el.timeline.scrollHeight;
  }

  function addTimelineDivider(text) {
    const li = document.createElement("li");
    li.className = "timeline-entry";
    li.style.borderLeftColor = "var(--conduit-bright)";
    li.innerHTML = `<div class="timeline-entry__detail" style="color:var(--haze-dim);text-transform:uppercase;letter-spacing:.06em;">${text}</div>`;
    el.timeline.appendChild(li);
    el.timeline.scrollTop = el.timeline.scrollHeight;
  }

  // ===================================================================
  // Pipeline strip
  // ===================================================================

  function setPipelineActive(stageKey) {
    const activeIdx = PIPELINE_ORDER.indexOf(stageKey);
    el.pipeline.forEach((node) => {
      const idx = PIPELINE_ORDER.indexOf(node.dataset.stage);
      node.classList.remove("is-active", "is-done");
      if (stageKey === null) return;
      if (idx < activeIdx) node.classList.add("is-done");
      else if (idx === activeIdx) node.classList.add("is-active");
    });
  }

  // ===================================================================
  // Result card
  // ===================================================================

  function showResult(trace) {
    el.resultCard.hidden = false;
    if (trace.success) {
      const row = trace.chosenRow;
      el.resultCard.innerHTML = `
        <div class="result-card__tag">ALLOCATION SUCCESSFUL</div>
        <div class="result-card__flow">
          <span class="result-card__product">${trace.product.name}</span>
          <span class="result-card__arrow">&rarr;</span>
          <span class="result-card__slot">${row.slotId}</span>
        </div>
        <div class="result-card__stats">
          <div><div class="result-card__stat-label">Required</div><div class="result-card__stat-value">${trace.product.requiredSpace} units</div></div>
          <div><div class="result-card__stat-label">Remaining</div><div class="result-card__stat-value">${row.leftover} units</div></div>
          <div><div class="result-card__stat-label">Strategy</div><div class="result-card__stat-value">Greedy Best-Fit</div></div>
          <div><div class="result-card__stat-label">Selection</div><div class="result-card__stat-value">Max Heap</div></div>
        </div>`;
    } else {
      el.resultCard.innerHTML = `
        <div class="result-card__tag is-fail">ALLOCATION FAILED</div>
        <div class="result-card__flow">
          <span class="result-card__product">${trace.product.name}</span>
          <span class="result-card__arrow">&rarr;</span>
          <span class="result-card__slot" style="color:var(--alert)">NO SLOT</span>
        </div>
        <div class="result-card__stats">
          <div><div class="result-card__stat-label">Required</div><div class="result-card__stat-value">${trace.product.requiredSpace} units</div></div>
          <div><div class="result-card__stat-label">Result</div><div class="result-card__stat-value" style="color:var(--alert)">No suitable storage slot available</div></div>
        </div>`;
    }
  }

  // ===================================================================
  // Presentation summary
  // ===================================================================

  function updatePresentationSummary(fields) {
    el.presentationSummary.hidden = false;
    el.presentationSummary.innerHTML = `
      <div class="panel-head"><h2>Presentation Summary</h2></div>
      <div class="presentation-summary__grid">
        <div class="presentation-summary__item"><span class="presentation-summary__label">Current Step</span><span class="presentation-summary__value">${fields.step || "—"}</span></div>
        <div class="presentation-summary__item"><span class="presentation-summary__label">Current Product</span><span class="presentation-summary__value">${fields.product || "—"}</span></div>
        <div class="presentation-summary__item"><span class="presentation-summary__label">Current Candidates</span><span class="presentation-summary__value">${fields.candidates || "—"}</span></div>
        <div class="presentation-summary__item"><span class="presentation-summary__label">Current Heap</span><span class="presentation-summary__value">${fields.heap || "—"}</span></div>
        <div class="presentation-summary__item"><span class="presentation-summary__label">Current Decision</span><span class="presentation-summary__value">${fields.decision || "—"}</span></div>
      </div>`;
  }

  // ===================================================================
  // Stage builder — turns one trace into an ordered list of replay steps
  // ===================================================================

  function buildStages(trace) {
    const stages = [];
    const { product, scanRows, success, chosenRow, bestEntry, events } = trace;
    const productLabel = `${product.name} (${product.id}) &middot; needs ${product.requiredSpace} units`;

    addTimelineDivider(`${product.name} (${product.id}) arrives &middot; needs ${product.requiredSpace} units`);

    stages.push({
      label: "Array Scan",
      run: async () => {
        setPipelineActive("array");
        updatePresentationSummary({ step: "Array Scan", product: productLabel });
        hideGreedyDecision();
        clearHeap();
        el.resultCard.hidden = true;
        const overrides = await sweepScan(scanRows);
        renderGreedyTable(scanRows, null);
        addTimelineEntry("01", "Array Scan", `${scanRows.length} slots examined`);
        return overrides;
      },
    });

    stages.push({
      label: "Feasibility",
      run: async (ctx) => {
        const feasibleCount = scanRows.filter((r) => r.feasible).length;
        addTimelineEntry("02", "Feasibility", `${feasibleCount} candidate${feasibleCount === 1 ? "" : "s"} found`);
        updatePresentationSummary({
          step: "Feasibility",
          product: productLabel,
          candidates: feasibleCount ? scanRows.filter((r) => r.feasible).map((r) => r.slotId).join(", ") : "none",
        });
        if (!success) {
          addTimelineEntry(null, "No Suitable Storage Slot Available", "", { empty: true });
          renderWarehouse();
          showResult(trace);
          setPipelineActive(null);
          updatePresentationSummary({
            step: "No Suitable Slot",
            product: productLabel,
            candidates: "none",
            decision: "Not allocated",
          });
        }
        return ctx;
      },
    });

    if (!success) return stages;

    stages.push({
      label: "Greedy Score",
      run: async () => {
        setPipelineActive("greedy");
        addTimelineEntry("03", "Greedy Score", `Scores calculated for ${trace.candidates.length} candidates`);
        updatePresentationSummary({
          step: "Greedy Score",
          product: productLabel,
          candidates: scanRows.filter((r) => r.feasible).map((r) => `${r.slotId}:${r.score}`).join(", "),
        });
      },
    });

    stages.push({
      label: "Max Heap",
      run: async () => {
        setPipelineActive("heap");
        const insertEvents = events.filter((e) => e.type === "HEAP_INSERT");
        for (const ev of insertEvents) {
          renderHeap(ev.heapSnapshot);
          updatePresentationSummary({
            step: "Max Heap — inserting",
            product: productLabel,
            heap: "[" + ev.heapSnapshot.map((h) => `(${h.score},${slotIdFor(h.slotIndex)})`).join(", ") + "]",
          });
          await wait(320);
        }
        addTimelineEntry("04", "Max Heap", `${insertEvents.length} candidates inserted`);
      },
    });

    stages.push({
      label: "Extract Max",
      run: async () => {
        setPipelineActive("best");
        const stepEvents = events.filter((e) => e.type === "EXTRACT_STEP");
        for (const ev of stepEvents) {
          renderHeap(ev.heapSnapshot);
          await wait(320);
        }
        if (stepEvents.length === 0) {
          const buildDone = events.find((e) => e.type === "HEAP_BUILD_DONE");
          if (buildDone) renderHeap(buildDone.heapSnapshot.slice(1));
        }
        renderGreedyTable(scanRows, chosenRow.slotIndex);
        showGreedyDecision(chosenRow);
        renderWarehouse(new Map([[chosenRow.slotIndex, { key: "best", label: "BEST SLOT" }]]));
        addTimelineEntry("05", "Extract Max", `${chosenRow.slotId} selected`);
        updatePresentationSummary({
          step: "Extract Max",
          product: productLabel,
          decision: `${chosenRow.slotId} &middot; leftover ${chosenRow.leftover} &middot; score ${chosenRow.score}`,
        });
      },
    });

    stages.push({
      label: "Update Array",
      run: async () => {
        setPipelineActive("update");
        renderWarehouse(new Map([[chosenRow.slotIndex, { key: "best", label: "BEST SLOT" }]]));
        await wait(260);
        renderWarehouse();
        showResult(trace);
        addTimelineEntry("06", "Update Array", `${product.requiredSpace} units allocated to ${chosenRow.slotId}`);
        updatePresentationSummary({
          step: "Update Array — complete",
          product: productLabel,
          decision: `${chosenRow.slotId} &middot; leftover ${chosenRow.leftover} &middot; score ${chosenRow.score}`,
        });
      },
    });

    return stages;
  }

  // ===================================================================
  // Allocation flow
  // ===================================================================

  async function runStages(stages, { auto, delay }) {
    for (let i = state.currentStageIndex; i < stages.length; i++) {
      await stages[i].run();
      state.currentStageIndex = i + 1;
      if (!auto) return; // demo mode: stop after one stage
      if (i < stages.length - 1) await wait(delay);
    }
  }

  function setControlsBusy(busy) {
    state.busy = busy;
    el.allocateBtn.disabled = busy;
    el.runDemoBtn.disabled = busy;
    document.querySelectorAll(".sample-btn").forEach((b) => (b.disabled = busy));
  }

  async function allocate(product, opts) {
    opts = opts || {};
    const trace = DSAEngine.allocateProduct(state.warehouse, product);
    state.currentStages = buildStages(trace);
    state.currentStageIndex = 0;

    if (state.demoModeOn && !opts.forceAuto) {
      el.nextStepBtn.disabled = false;
      await state.currentStages[0].run();
      state.currentStageIndex = 1;
      if (state.currentStageIndex >= state.currentStages.length) el.nextStepBtn.disabled = true;
    } else {
      el.nextStepBtn.disabled = true;
      await runStages(state.currentStages, { auto: true, delay: 420 });
    }
  }

  function readFormProduct() {
    const id = DSAEngine.nextProductId();
    const name = el.productName.value.trim() || "Unnamed Item";
    const requiredSpace = Math.max(1, parseInt(el.productSpace.value, 10) || 0);
    return { id, name, requiredSpace };
  }

  // ===================================================================
  // Event wiring
  // ===================================================================

  el.productForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.busy) return;
    if (!el.productSpace.value) return;
    setControlsBusy(true);
    try {
      const product = readFormProduct();
      el.productId.value = product.id;
      await allocate(product);
    } finally {
      setControlsBusy(false);
      el.productName.value = "";
      el.productSpace.value = "";
    }
  });

  document.querySelectorAll(".sample-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      el.productName.value = btn.dataset.name;
      el.productSpace.value = btn.dataset.space;
      el.productName.focus();
    });
  });

  el.demoToggle.addEventListener("change", () => {
    state.demoModeOn = el.demoToggle.checked;
  });

  el.presentationToggle.addEventListener("click", () => {
    state.presentationOn = !state.presentationOn;
    document.body.classList.toggle("presentation-mode", state.presentationOn);
    el.presentationToggle.classList.toggle("is-on", state.presentationOn);
    el.presentationSummary.hidden = false;
  });

  el.nextStepBtn.addEventListener("click", async () => {
    if (state.busy || !state.currentStages) return;
    if (state.currentStageIndex >= state.currentStages.length) return;
    setControlsBusy(true);
    el.nextStepBtn.disabled = true;
    try {
      await runStages(state.currentStages, { auto: false });
    } finally {
      setControlsBusy(false);
      el.nextStepBtn.disabled = state.currentStageIndex >= state.currentStages.length;
    }
  });

  el.runDemoBtn.addEventListener("click", async () => {
    if (state.busy) return;
    setControlsBusy(true);
    el.nextStepBtn.disabled = true;
    try {
      if (state.currentStages && state.currentStageIndex < state.currentStages.length) {
        // finish whatever allocation is mid-flight
        await runStages(state.currentStages, { auto: true, delay: 420 });
      } else {
        // nothing pending — showcase the full canonical scenario
        for (const sample of SAMPLE_PRODUCTS) {
          const product = { id: DSAEngine.nextProductId(), name: sample.name, requiredSpace: sample.space };
          el.productId.value = product.id;
          await allocate(product, { forceAuto: true });
          await wait(650);
        }
      }
    } finally {
      setControlsBusy(false);
      el.nextStepBtn.disabled = !state.currentStages || state.currentStageIndex >= state.currentStages.length;
    }
  });

  el.resetBtn.addEventListener("click", () => {
    state.warehouse = DSAEngine.initialWarehouse();
    DSAEngine.resetProductCounter();
    state.currentStages = null;
    state.currentStageIndex = 0;
    el.timeline.innerHTML = "";
    el.greedyTableBody.innerHTML = "";
    hideGreedyDecision();
    clearHeap();
    el.resultCard.hidden = true;
    el.productId.value = "";
    el.productName.value = "";
    el.productSpace.value = "";
    el.nextStepBtn.disabled = true;
    setPipelineActive(null);
    el.presentationSummary.hidden = true;
    renderWarehouse();
  });

  // ===================================================================
  // Init
  // ===================================================================

  renderWarehouse();
  setPipelineActive(null);
})();
