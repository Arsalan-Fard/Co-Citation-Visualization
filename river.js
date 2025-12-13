/* global d3 */

const CSV_PATHS = {
  main: "data/main_papers.csv",
  references: "data/references.csv",
  citation: "data/citation.csv",
};

const DIM_LABELS = {
  paper_field: "Field",
  paper_subfield: "Subfield",
  paper_topic: "Topic",
};

const COLORS = {
  read: "#4ADE80",
  unread: "rgba(148, 163, 184, 0.95)",
  foundation: "rgba(148, 163, 184, 0.55)",
  audience: "rgba(196, 181, 253, 0.55)",
  unknown: "rgba(226, 232, 240, 0.35)",
};

const formatInt = d3.format(",");

const state = {
  foundationDim: "paper_field",
  audienceDim: "paper_field",
  paperScope: "story",
  maxCategories: 12,
  showOther: true,
  weightMode: "count", // count | share
  selectedPaperId: null,
  highlightTopic: null,
};

const ui = {
  overlay: document.getElementById("overlay"),
  riverStats: document.getElementById("river-stats"),
  selectionPill: document.getElementById("selection-pill"),
  coverageStats: document.getElementById("coverage-stats"),
  bridgeStats: document.getElementById("bridge-stats"),
  bridgeList: document.getElementById("bridge-list"),
  paperDetails: document.getElementById("paper-details"),
  sankeySvg: d3.select("#river-sankey"),
  coverageSvg: d3.select("#coverage-bars"),
  paperFoundationsSvg: d3.select("#paper-foundations"),
  paperAudienceSvg: d3.select("#paper-audience"),
};

function showOverlay(messageHtml) {
  ui.overlay.innerHTML = messageHtml;
  ui.overlay.style.display = "flex";
}

function hideOverlay() {
  ui.overlay.style.display = "none";
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normKey(value) {
  const str = (value ?? "").toString().trim();
  return str.length ? str : "Unknown";
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function truncate(text, max = 72) {
  const s = (text ?? "").toString();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 3))}...`;
}

function parseYear(dateStr) {
  if (!dateStr) return null;
  const parsed = Date.parse(dateStr);
  if (!Number.isFinite(parsed)) {
    const lastPart = dateStr.split("/").pop();
    const y = Number(lastPart);
    return Number.isFinite(y) ? y : null;
  }
  return new Date(parsed).getFullYear();
}

function getDim(row, key) {
  return normKey(row[key]);
}

function sumMapValues(map) {
  let sum = 0;
  map.forEach(v => {
    sum += v;
  });
  return sum;
}

function topKeysByValue(map, limit, alwaysInclude = []) {
  const entries = Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
  const set = new Set(entries);
  alwaysInclude.forEach(k => set.add(k));
  return set;
}

function addToNestedCount(target, outerKey, innerKey, amount) {
  if (!target.has(outerKey)) target.set(outerKey, new Map());
  const inner = target.get(outerKey);
  inner.set(innerKey, (inner.get(innerKey) || 0) + amount);
}

function buildPaperCategoryCounts(rows, paperIdKey, categoryKey) {
  const out = new Map(); // paperId -> Map(category -> count)
  rows.forEach(row => {
    const paperId = normKey(row[paperIdKey]);
    const cat = getDim(row, categoryKey);
    addToNestedCount(out, paperId, cat, 1);
  });
  return out;
}

function totalsForPapers(paperCounts, paperIds) {
  const totals = new Map();
  paperIds.forEach(id => {
    const m = paperCounts.get(id);
    totals.set(id, m ? sumMapValues(m) : 0);
  });
  return totals;
}

function aggregateCategoryTotals(paperCounts, paperIds) {
  const totals = new Map();
  paperIds.forEach(id => {
    const counts = paperCounts.get(id);
    if (!counts) return;
    counts.forEach((value, cat) => {
      totals.set(cat, (totals.get(cat) || 0) + value);
    });
  });
  return totals;
}

function getSelectedPaperIds(allPaperIds, readSet, shortlistIds) {
  if (state.paperScope === "all") return new Set(allPaperIds);
  if (state.paperScope === "read") return new Set(Array.from(allPaperIds).filter(id => readSet.has(id)));
  if (state.paperScope === "unread") return new Set(Array.from(allPaperIds).filter(id => !readSet.has(id)));
  if (state.paperScope === "story") {
    const set = new Set(Array.from(allPaperIds).filter(id => readSet.has(id)));
    shortlistIds.forEach(id => set.add(id));
    return set;
  }
  return new Set(allPaperIds);
}

function computeTopicColors(mainMeta) {
  const topics = Array.from(new Set(Array.from(mainMeta.values()).map(d => d.primaryTopic).filter(Boolean)));
  const palette = [
    "#6C8BFF", "#FF8A5B", "#4FD1C5", "#F97316", "#A855F7",
    "#10B981", "#F472B6", "#38BDF8", "#FACC15", "#EC4899",
    "#14B8A6", "#FBBF24", "#F87171", "#22D3EE", "#C084FC",
    "#F59E0B", "#34D399", "#FB7185", "#3B82F6", "#D946EF",
  ];
  const scale = d3.scaleOrdinal().domain(topics).range(palette.concat(palette));
  return {
    scale,
    get(topic) {
      if (!topic) return COLORS.unknown;
      return scale(topic);
    },
  };
}

function computeBridgeScores({
  allPaperIds,
  readSet,
  mainMeta,
  foundationsByPaper,
  audienceByPaper,
}) {
  const readIds = Array.from(readSet);
  const unreadIds = Array.from(allPaperIds).filter(id => !readSet.has(id));

  const readFoundationTotals = aggregateCategoryTotals(foundationsByPaper, readIds);
  const readAudienceTotals = aggregateCategoryTotals(audienceByPaper, readIds);
  const totalReadFoundation = sumMapValues(readFoundationTotals);
  const totalReadAudience = sumMapValues(readAudienceTotals);

  const readFoundationShare = cat =>
    totalReadFoundation > 0 ? (readFoundationTotals.get(cat) || 0) / totalReadFoundation : 0;
  const readAudienceShare = cat =>
    totalReadAudience > 0 ? (readAudienceTotals.get(cat) || 0) / totalReadAudience : 0;

  const overlapRaw = new Map();
  const noveltyRaw = new Map();
  const explain = new Map();

  unreadIds.forEach(paperId => {
    const fCounts = foundationsByPaper.get(paperId) || new Map();
    const aCounts = audienceByPaper.get(paperId) || new Map();

    let overlap = 0;
    const overlapParts = [];
    fCounts.forEach((count, cat) => {
      const part = count * readFoundationShare(cat);
      overlap += part;
      overlapParts.push({ cat, value: part, count });
    });

    let novelty = 0;
    const noveltyParts = [];
    aCounts.forEach((count, cat) => {
      const part = count * (1 - readAudienceShare(cat));
      novelty += part;
      noveltyParts.push({ cat, value: part, count });
    });

    overlapRaw.set(paperId, overlap);
    noveltyRaw.set(paperId, novelty);

    overlapParts.sort((a, b) => b.value - a.value);
    noveltyParts.sort((a, b) => b.value - a.value);

    const meta = mainMeta.get(paperId) || {};
    explain.set(paperId, {
      paperId,
      title: meta.title || paperId,
      year: meta.year ?? null,
      citedBy: meta.citedBy ?? null,
      primaryTopic: meta.primaryTopic || null,
      overlapTop: overlapParts.slice(0, 3),
      noveltyTop: noveltyParts.slice(0, 3),
    });
  });

  const maxOverlap = d3.max(Array.from(overlapRaw.values())) || 1;
  const maxNovelty = d3.max(Array.from(noveltyRaw.values())) || 1;

  const scored = unreadIds.map(paperId => {
    const overlap = overlapRaw.get(paperId) || 0;
    const novelty = noveltyRaw.get(paperId) || 0;
    const overlapNorm = overlap / maxOverlap;
    const noveltyNorm = novelty / maxNovelty;
    const bridge = overlapNorm * noveltyNorm;
    return {
      paperId,
      bridge,
      overlapNorm,
      noveltyNorm,
      explain: explain.get(paperId),
    };
  });

  scored.sort((a, b) => b.bridge - a.bridge);
  return scored;
}

function renderBridgeList(bridgeScores, onSelect) {
  const top = bridgeScores.slice(0, 10);
  ui.bridgeStats.textContent = `Top ${top.length} (unread)`;
  ui.bridgeList.innerHTML = "";

  top.forEach((d, idx) => {
    const item = document.createElement("div");
    item.className = "item";
    if (d.paperId === state.selectedPaperId) item.classList.add("selected");

    const explain = d.explain || {};
    const overlapTop = (explain.overlapTop || []).map(x => x.cat).filter(Boolean).join(", ");
    const noveltyTop = (explain.noveltyTop || []).map(x => x.cat).filter(Boolean).join(", ");

    item.innerHTML = `
      <div class="item-title">${idx + 1}. ${truncate(explain.title || d.paperId, 85)}</div>
      <div class="item-meta">
        <div class="kv"><span>Bridge</span><span>${d.bridge.toFixed(3)}</span></div>
        <div class="kv"><span>Year</span><span>${explain.year ?? "—"}</span></div>
        <div class="kv"><span>Familiar</span><span>${truncate(overlapTop || "—", 42)}</span></div>
        <div class="kv"><span>Novel</span><span>${truncate(noveltyTop || "—", 42)}</span></div>
      </div>
    `;
    item.addEventListener("click", () => onSelect(d.paperId, { source: "bridge" }));
    ui.bridgeList.appendChild(item);
  });
}

let highlightTopicListeners = [];
function dispatchHighlightTopic() {
  highlightTopicListeners.forEach(fn => fn(state.highlightTopic));
}

function renderCoverageBars(mainMeta, allPaperIds, readSet, topicColors) {
  const byTopic = new Map(); // topic -> {read, unread, total}
  Array.from(allPaperIds).forEach(paperId => {
    const meta = mainMeta.get(paperId) || {};
    const topic = meta.primaryTopic || "Unknown";
    if (!byTopic.has(topic)) byTopic.set(topic, { topic, read: 0, unread: 0, total: 0 });
    const row = byTopic.get(topic);
    if (readSet.has(paperId)) row.read += 1;
    else row.unread += 1;
    row.total += 1;
  });

  const rows = Array.from(byTopic.values()).sort((a, b) => b.total - a.total);
  const top = rows.slice(0, 14);
  const rest = rows.slice(14);
  if (rest.length) {
    const other = rest.reduce(
      (acc, r) => {
        acc.read += r.read;
        acc.unread += r.unread;
        acc.total += r.total;
        return acc;
      },
      { topic: "Other", read: 0, unread: 0, total: 0 },
    );
    top.push(other);
  }

  const readCount = Array.from(allPaperIds).filter(id => readSet.has(id)).length;
  ui.coverageStats.textContent = `${readCount}/${allPaperIds.size} read`;

  const svg = ui.coverageSvg;
  const width = svg.node().getBoundingClientRect().width || 520;
  const height = svg.node().getBoundingClientRect().height || 220;
  const margin = { top: 12, right: 12, bottom: 12, left: 160 };

  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const innerW = Math.max(10, width - margin.left - margin.right);
  const innerH = Math.max(10, height - margin.top - margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const y = d3
    .scaleBand()
    .domain(top.map(d => d.topic))
    .range([0, innerH])
    .padding(0.18);

  const x = d3
    .scaleLinear()
    .domain([0, d3.max(top, d => d.total) || 1])
    .range([0, innerW]);

  g.append("g")
    .call(d3.axisLeft(y).tickSize(0))
    .selectAll("text")
    .attr("fill", "rgba(226, 232, 240, 0.75)")
    .attr("font-size", 11);
  g.selectAll(".domain").remove();

  const row = g
    .selectAll(".row")
    .data(top)
    .join("g")
    .attr("class", "row")
    .attr("transform", d => `translate(0, ${y(d.topic)})`)
    .style("cursor", "pointer")
    .on("click", (_, d) => {
      state.highlightTopic = state.highlightTopic === d.topic ? null : d.topic;
      dispatchHighlightTopic();
    });

  row.append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("height", y.bandwidth())
    .attr("width", d => x(d.total))
    .attr("fill", "rgba(148, 163, 184, 0.14)")
    .attr("rx", 6);

  row.append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("height", y.bandwidth())
    .attr("width", d => x(d.read))
    .attr("fill", COLORS.read)
    .attr("rx", 6)
    .attr("opacity", 0.75);

  row.append("text")
    .attr("x", d => x(d.total) + 8)
    .attr("y", y.bandwidth() / 2)
    .attr("dy", "0.32em")
    .attr("fill", "rgba(226, 232, 240, 0.62)")
    .attr("font-size", 11)
    .text(d => `${d.read}/${d.total}`);

  svg
    .append("g")
    .attr("transform", `translate(${margin.left - 14},${margin.top})`)
    .selectAll("circle")
    .data(top)
    .join("circle")
    .attr("cx", 0)
    .attr("cy", d => (y(d.topic) || 0) + y.bandwidth() / 2)
    .attr("r", 4.6)
    .attr("fill", d => (d.topic === "Other" ? "rgba(226,232,240,0.35)" : topicColors.get(d.topic)))
    .attr("opacity", 0.85);
}

function renderMiniBars(svg, items, options) {
  const { title, color, maxBars = 6 } = options;
  svg.selectAll("*").remove();

  const width = svg.node().getBoundingClientRect().width || 520;
  const height = svg.node().getBoundingClientRect().height || 160;
  const margin = { top: 14, right: 14, bottom: 14, left: 170 };
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const data = items.slice(0, maxBars);
  const innerW = Math.max(10, width - margin.left - margin.right);
  const innerH = Math.max(10, height - margin.top - margin.bottom);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const y = d3
    .scaleBand()
    .domain(data.map(d => d.key))
    .range([0, innerH])
    .padding(0.18);

  const x = d3
    .scaleLinear()
    .domain([0, d3.max(data, d => d.value) || 1])
    .range([0, innerW]);

  g.append("g")
    .call(d3.axisLeft(y).tickSize(0))
    .selectAll("text")
    .attr("fill", "rgba(226, 232, 240, 0.75)")
    .attr("font-size", 11);
  g.selectAll(".domain").remove();

  g.selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", 0)
    .attr("y", d => y(d.key))
    .attr("height", y.bandwidth())
    .attr("width", d => x(d.value))
    .attr("fill", color)
    .attr("opacity", 0.72)
    .attr("rx", 6);

  g.selectAll(".val")
    .data(data)
    .join("text")
    .attr("class", "val")
    .attr("x", d => x(d.value) + 8)
    .attr("y", d => (y(d.key) || 0) + y.bandwidth() / 2)
    .attr("dy", "0.32em")
    .attr("fill", "rgba(226, 232, 240, 0.62)")
    .attr("font-size", 11)
    .text(d => d.label ?? `${d.value.toFixed(2)}`);

  svg
    .append("text")
    .attr("x", 12)
    .attr("y", 16)
    .attr("fill", "rgba(226, 232, 240, 0.6)")
    .attr("font-size", 11)
    .attr("font-weight", 650)
    .text(title);
}

function renderSelectedPaperDetails({
  paperId,
  mainMeta,
  readSet,
  foundationsByPaper,
  audienceByPaper,
  bridgeScoresById,
}) {
  if (!paperId) {
    ui.selectionPill.textContent = "None";
    ui.paperDetails.innerHTML =
      '<div style="color: rgba(226,232,240,0.65); font-size: 12px; line-height: 1.35;">Click a paper node or a shortlist item to see its foundations, audience, and bridge explanation.</div>';
    renderMiniBars(ui.paperFoundationsSvg, [], { title: "Foundations", color: COLORS.foundation });
    renderMiniBars(ui.paperAudienceSvg, [], { title: "Audience", color: COLORS.audience });
    return;
  }

  const meta = mainMeta.get(paperId) || {};
  const isRead = readSet.has(paperId);
  ui.selectionPill.textContent = isRead ? "Read" : "Unread";

  const badgeLabel = isRead ? "Read" : "Unread";
  const badgeDotColor = isRead ? COLORS.read : COLORS.unread;

  const score = bridgeScoresById.get(paperId);
  const scoreLine =
    score && !isRead
      ? `<div class="kv"><span>Bridge</span><span>${score.bridge.toFixed(3)} (familiar ${score.overlapNorm.toFixed(
          2,
        )} × novel ${score.noveltyNorm.toFixed(2)})</span></div>`
      : "";

  ui.paperDetails.innerHTML = `
    <div class="headline">
      <div class="badge"><span class="dot" style="background:${badgeDotColor};"></span><span>${badgeLabel}</span></div>
      <div style="font-size: 13px; font-weight: 700; line-height: 1.25; color: rgba(226,232,240,0.92);">
        ${truncate(meta.title || paperId, 120)}
      </div>
      <div style="color: rgba(226,232,240,0.6); font-size: 12px;">${paperId}</div>
    </div>
    <div class="item-meta" style="grid-template-columns: 1fr;">
      <div class="kv"><span>Topic</span><span>${meta.primaryTopic || "Unknown"}</span></div>
      <div class="kv"><span>Year</span><span>${meta.year ?? "—"}</span></div>
      <div class="kv"><span>Cited by</span><span>${meta.citedBy != null ? formatInt(meta.citedBy) : "—"}</span></div>
      ${scoreLine}
    </div>
  `;

  const fCounts = foundationsByPaper.get(paperId) || new Map();
  const aCounts = audienceByPaper.get(paperId) || new Map();

  const foundationItems = Array.from(fCounts.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);

  const audienceItems = Array.from(aCounts.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);

  renderMiniBars(ui.paperFoundationsSvg, foundationItems, {
    title: `Foundations (${DIM_LABELS[state.foundationDim]})`,
    color: COLORS.foundation,
  });
  renderMiniBars(ui.paperAudienceSvg, audienceItems, {
    title: `Audience (${DIM_LABELS[state.audienceDim]})`,
    color: COLORS.audience,
  });
}

function buildSankeyGraph({
  allPaperIds,
  readSet,
  mainMeta,
  topicColors,
  foundationsByPaper,
  audienceByPaper,
  shortlistIds,
}) {
  const selectedPapers = getSelectedPaperIds(allPaperIds, readSet, shortlistIds);

  const foundationTotals = aggregateCategoryTotals(foundationsByPaper, selectedPapers);
  const audienceTotals = aggregateCategoryTotals(audienceByPaper, selectedPapers);

  const alwaysInclude = ["Unknown"];
  const topFoundationCats = topKeysByValue(foundationTotals, state.maxCategories, alwaysInclude);
  const topAudienceCats = topKeysByValue(audienceTotals, state.maxCategories, alwaysInclude);

  if (state.showOther) {
    topFoundationCats.add("Other");
    topAudienceCats.add("Other");
  }

  const nodes = [];
  const nodeIndex = new Map();
  const addNode = node => {
    if (nodeIndex.has(node.id)) return;
    nodeIndex.set(node.id, nodes.length);
    nodes.push(node);
  };

  Array.from(topFoundationCats).forEach(cat => {
    addNode({
      id: `F:${cat}`,
      name: cat,
      type: "foundation",
      category: cat,
    });
  });

  Array.from(selectedPapers).forEach(paperId => {
    const meta = mainMeta.get(paperId) || {};
    addNode({
      id: `P:${paperId}`,
      name: meta.title ? truncate(meta.title, 44) : paperId,
      type: "paper",
      paperId,
      read: readSet.has(paperId),
      primaryTopic: meta.primaryTopic || "Unknown",
      color: topicColors.get(meta.primaryTopic),
    });
  });

  Array.from(topAudienceCats).forEach(cat => {
    addNode({
      id: `A:${cat}`,
      name: cat,
      type: "audience",
      category: cat,
    });
  });

  const paperFoundationTotals = totalsForPapers(foundationsByPaper, selectedPapers);
  const paperAudienceTotals = totalsForPapers(audienceByPaper, selectedPapers);

  const linksAgg = new Map(); // key -> {source,target,value,paperId}
  const addLink = (sourceId, targetId, paperId, value) => {
    const key = `${sourceId}→${targetId}`;
    const prev = linksAgg.get(key);
    if (prev) prev.value += value;
    else linksAgg.set(key, { source: sourceId, target: targetId, value, paperId });
  };

  Array.from(selectedPapers).forEach(paperId => {
    const fCounts = foundationsByPaper.get(paperId) || new Map();
    const aCounts = audienceByPaper.get(paperId) || new Map();

    const fTotal = paperFoundationTotals.get(paperId) || 0;
    const aTotal = paperAudienceTotals.get(paperId) || 0;

    fCounts.forEach((count, catRaw) => {
      const cat = topFoundationCats.has(catRaw) ? catRaw : state.showOther ? "Other" : null;
      if (!cat) return;
      const value = state.weightMode === "share" && fTotal > 0 ? count / fTotal : count;
      addLink(`F:${cat}`, `P:${paperId}`, paperId, value);
    });

    aCounts.forEach((count, catRaw) => {
      const cat = topAudienceCats.has(catRaw) ? catRaw : state.showOther ? "Other" : null;
      if (!cat) return;
      const value = state.weightMode === "share" && aTotal > 0 ? count / aTotal : count;
      addLink(`P:${paperId}`, `A:${cat}`, paperId, value);
    });
  });

  const links = Array.from(linksAgg.values()).filter(l => nodeIndex.has(l.source) && nodeIndex.has(l.target));

  return {
    nodes,
    links,
  };
}

function renderSankey({
  graphData,
  readSet,
  mainMeta,
  topicColors,
  onSelectPaper,
  onClearSelection,
}) {
  if (!d3.sankey) {
    showOverlay(
      'Missing dependency: <strong>d3-sankey</strong> not loaded. Ensure the script tag loads successfully (internet access).',
    );
    return;
  }
  hideOverlay();

  const svg = ui.sankeySvg;
  const wrap = document.getElementById("sankey-wrap");
  const width = Math.max(600, wrap.getBoundingClientRect().width || 980);
  const height = Math.max(540, wrap.getBoundingClientRect().height || 680);
  svg.attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();

  const margin = { top: 26, right: 16, bottom: 14, left: 16 };
  const extent = [
    [margin.left, margin.top + 18],
    [width - margin.right, height - margin.bottom],
  ];

  const sankey = d3
    .sankey()
    .nodeId(d => d.id)
    .nodeWidth(14)
    .nodePadding(8)
    .nodeAlign(d3.sankeyJustify)
    .extent(extent);

  const graph = sankey({
    nodes: graphData.nodes.map(d => ({ ...d })),
    links: graphData.links.map(d => ({ ...d })),
  });

  svg.on("click", (event) => {
    if (event.target.tagName.toLowerCase() === "svg") {
      onClearSelection();
    }
  });

  const axis = svg.append("g");
  axis
    .append("text")
    .attr("class", "axis-label")
    .attr("x", extent[0][0])
    .attr("y", margin.top)
    .text(`Foundations (${DIM_LABELS[state.foundationDim]})`);
  axis
    .append("text")
    .attr("class", "axis-label")
    .attr("x", (extent[0][0] + extent[1][0]) / 2)
    .attr("y", margin.top)
    .attr("text-anchor", "middle")
    .text("Your Papers");
  axis
    .append("text")
    .attr("class", "axis-label")
    .attr("x", extent[1][0])
    .attr("y", margin.top)
    .attr("text-anchor", "end")
    .text(`Audience (${DIM_LABELS[state.audienceDim]})`);

  const linkLayer = svg.append("g").attr("class", "links");
  const nodeLayer = svg.append("g").attr("class", "nodes");
  const labelLayer = svg.append("g").attr("class", "labels");

  const link = linkLayer
    .selectAll("path")
    .data(graph.links)
    .join("path")
    .attr("class", "sankey-link")
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", d => {
      const paperId = d.paperId;
      const meta = mainMeta.get(paperId) || {};
      return topicColors.get(meta.primaryTopic);
    })
    .attr("stroke-width", d => Math.max(1, d.width))
    .attr("stroke-opacity", d => (readSet.has(d.paperId) ? 0.42 : 0.18));

  const node = nodeLayer
    .selectAll("rect")
    .data(graph.nodes)
    .join("rect")
    .attr("class", "sankey-node")
    .attr("x", d => d.x0)
    .attr("y", d => d.y0)
    .attr("height", d => Math.max(1, d.y1 - d.y0))
    .attr("width", d => d.x1 - d.x0)
    .attr("fill", d => {
      if (d.type === "paper") return d.color || COLORS.unknown;
      if (d.type === "foundation") return COLORS.foundation;
      if (d.type === "audience") return COLORS.audience;
      return COLORS.unknown;
    })
    .attr("opacity", d => {
      if (d.type !== "paper") return 0.9;
      return d.read ? 0.9 : 0.5;
    })
    .style("cursor", d => (d.type === "paper" ? "pointer" : "default"))
    .on("click", (event, d) => {
      event.stopPropagation();
      if (d.type === "paper") onSelectPaper(d.paperId, { source: "node" });
    });

  node.append("title").text(d => {
    if (d.type === "paper") {
      const meta = mainMeta.get(d.paperId) || {};
      const parts = [];
      parts.push(meta.title || d.paperId);
      parts.push(readSet.has(d.paperId) ? "Read" : "Unread");
      if (meta.primaryTopic) parts.push(`Topic: ${meta.primaryTopic}`);
      if (meta.year != null) parts.push(`Year: ${meta.year}`);
      if (meta.citedBy != null) parts.push(`Cited by: ${meta.citedBy}`);
      return parts.join("\n");
    }
    return `${d.name}\nTotal: ${formatInt(d.value)}`;
  });

  labelLayer
    .selectAll("text")
    .data(graph.nodes.filter(d => d.type !== "paper"))
    .join("text")
    .attr("class", "sankey-node-label")
    .attr("x", d => (d.x0 < width / 2 ? d.x1 + 8 : d.x0 - 8))
    .attr("y", d => (d.y0 + d.y1) / 2)
    .attr("text-anchor", d => (d.x0 < width / 2 ? "start" : "end"))
    .attr("dy", "0.35em")
    .text(d => truncate(d.name, 34));

  function applyHighlightBySelection() {
    const selectedPaperId = state.selectedPaperId;
    const highlightTopic = state.highlightTopic;
    const hasSelection = !!selectedPaperId;
    const hasTopic = !!highlightTopic;

    if (!hasSelection && !hasTopic) {
      node.classed("dimmed", false);
      link.classed("dimmed", false);
      return;
    }

    const paperIdsToKeep = new Set();
    if (hasSelection) paperIdsToKeep.add(selectedPaperId);
    if (hasTopic) {
      graph.nodes.forEach(n => {
        if (n.type !== "paper") return;
        const meta = mainMeta.get(n.paperId) || {};
        if ((meta.primaryTopic || "Unknown") === highlightTopic) paperIdsToKeep.add(n.paperId);
      });
    }

    node.classed("dimmed", d => d.type === "paper" && !paperIdsToKeep.has(d.paperId));
    link.classed("dimmed", d => !paperIdsToKeep.has(d.paperId));
  }

  node
    .on("mouseenter", (_, d) => {
      if (d.type !== "paper" || state.selectedPaperId) return;
      link.classed("highlighted", l => l.paperId === d.paperId);
      node.classed("highlighted", n => n.type === "paper" && n.paperId === d.paperId);
    })
    .on("mouseleave", () => {
      link.classed("highlighted", false);
      node.classed("highlighted", false);
      applyHighlightBySelection();
    });

  highlightTopicListeners = [applyHighlightBySelection];
  applyHighlightBySelection();

  const paperCount = graph.nodes.filter(d => d.type === "paper").length;
  const readCount = graph.nodes.filter(d => d.type === "paper" && d.read).length;
  const categoryCount = graph.nodes.filter(d => d.type !== "paper").length;
  ui.riverStats.textContent = `${paperCount} papers (${readCount} read) · ${categoryCount} categories`;
}

function attachControls(onChange) {
  const foundationSelect = document.getElementById("foundation-dim");
  const audienceSelect = document.getElementById("audience-dim");
  const scopeSelect = document.getElementById("paper-scope");
  const topInput = document.getElementById("top-categories");
  const showOther = document.getElementById("show-other");
  const weightMode = document.getElementById("weight-mode");

  const update = () => {
    state.foundationDim = foundationSelect.value;
    state.audienceDim = audienceSelect.value;
    state.paperScope = scopeSelect.value;
    state.maxCategories = clamp(Number(topInput.value || 12), 6, 30);
    state.showOther = !!showOther.checked;
    state.weightMode = weightMode.value;
    onChange();
  };

  foundationSelect.addEventListener("change", update);
  audienceSelect.addEventListener("change", update);
  scopeSelect.addEventListener("change", update);
  topInput.addEventListener("change", update);
  showOther.addEventListener("change", update);
  weightMode.addEventListener("change", update);
}

function main() {
  showOverlay(
    'Loading CSVs… If you opened this as a <strong>file://</strong> URL, use a local server (e.g. VS Code Live Server) so the browser can fetch <code>data/*.csv</code>.',
  );

  Promise.all([d3.csv(CSV_PATHS.main), d3.csv(CSV_PATHS.references), d3.csv(CSV_PATHS.citation)])
    .then(([mainRows, refRows, citRows]) => {
      hideOverlay();

      const mainMeta = new Map();
      const readSet = new Set();
      const allPaperIds = new Set();

      mainRows.forEach(row => {
        const id = normKey(row.id);
        allPaperIds.add(id);
        const isRead = String(row.read ?? "0").trim() === "1";
        if (isRead) readSet.add(id);
        mainMeta.set(id, {
          id,
          title: row.title || id,
          primaryTopic: normKey(row.primary_topic),
          year: parseYear(row.publication_date),
          citedBy: safeNumber(row.cited_by_count),
          venue: row.venue ? row.venue.trim() : null,
        });
      });

      const topicColors = computeTopicColors(mainMeta);

      let cachedDims = { foundationDim: null, audienceDim: null };
      let cachedCounts = { foundationsByPaper: new Map(), audienceByPaper: new Map() };

      function ensureCounts() {
        if (cachedDims.foundationDim === state.foundationDim && cachedDims.audienceDim === state.audienceDim) return;
        cachedCounts = {
          foundationsByPaper: buildPaperCategoryCounts(refRows, "source_paper_id", state.foundationDim),
          audienceByPaper: buildPaperCategoryCounts(citRows, "source_paper_id", state.audienceDim),
        };
        cachedDims = { foundationDim: state.foundationDim, audienceDim: state.audienceDim };
      }

      function rebuild() {
        ensureCounts();

        const bridgeScores = computeBridgeScores({
          allPaperIds,
          readSet,
          mainMeta,
          foundationsByPaper: cachedCounts.foundationsByPaper,
          audienceByPaper: cachedCounts.audienceByPaper,
        });

        const bridgeScoresById = new Map(bridgeScores.map(d => [d.paperId, d]));
        const shortlistIds = bridgeScores.slice(0, 10).map(d => d.paperId);

        renderCoverageBars(mainMeta, allPaperIds, readSet, topicColors);
        renderBridgeList(bridgeScores, (paperId) => {
          state.selectedPaperId = paperId;
          rebuild();
        });

        const graphData = buildSankeyGraph({
          allPaperIds,
          readSet,
          mainMeta,
          topicColors,
          foundationsByPaper: cachedCounts.foundationsByPaper,
          audienceByPaper: cachedCounts.audienceByPaper,
          shortlistIds,
        });

        renderSankey({
          graphData,
          readSet,
          mainMeta,
          topicColors,
          onSelectPaper: (paperId) => {
            state.selectedPaperId = paperId;
            rebuild();
          },
          onClearSelection: () => {
            state.selectedPaperId = null;
            rebuild();
          },
        });

        renderSelectedPaperDetails({
          paperId: state.selectedPaperId,
          mainMeta,
          readSet,
          foundationsByPaper: cachedCounts.foundationsByPaper,
          audienceByPaper: cachedCounts.audienceByPaper,
          bridgeScoresById,
        });
      }

      attachControls(() => {
        state.selectedPaperId = null;
        rebuild();
      });

      const ro = new ResizeObserver(() => rebuild());
      ro.observe(document.getElementById("sankey-wrap"));
      ro.observe(document.getElementById("coverage-bars").parentElement);
      ro.observe(document.getElementById("paper-foundations").parentElement);
      ro.observe(document.getElementById("paper-audience").parentElement);

      rebuild();
    })
    .catch(err => {
      showOverlay(
        `<div><strong>Could not load CSVs.</strong><br/>If you opened the HTML directly, run a local server so the browser can fetch <code>data/*.csv</code>.<br/><br/>Error: <code>${String(
          err,
        )}</code></div>`,
      );
      // eslint-disable-next-line no-console
      console.error(err);
    });
}

main();
