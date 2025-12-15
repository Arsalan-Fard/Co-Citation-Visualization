function buildColorRange(count) {
    if (count <= COLOR_PALETTE.length) {
        return COLOR_PALETTE.slice(0, count);
    }
    const range = [...COLOR_PALETTE];
    while (range.length < count) {
        range.push(...COLOR_PALETTE);
    }
    return range.slice(0, count);
}

function getNodeSizeValue(node, metricKey) {
    if (metricKey === "degree") return node.degree ?? null;
    if (metricKey === "weightedDegree") return node.weightedDegree ?? null;
    if (metricKey === "citation") return node.cited ?? null;
    return null;
}

function getNodeColorValue(node, metricKey) {
    if (metricKey === "venue") return node.venue || null;
    if (metricKey === "institution") return node.institution || null;
    if (metricKey === "topic") return node.primaryTopic || null;
    return null;
}

function computeMetricDomain(metricKey, nodes) {
    const def = AXIS_METRICS[metricKey];
    if (!def) return null;
    const values = nodes
        .map(def.valueAccessor)
        .filter(v => v != null);
    if (values.length === 0) return null;
    const extent = d3.extent(values);
    if (!extent || extent[0] == null || extent[1] == null) return null;
    if (def.scaleType === "time") {
        const start = new Date(extent[0]);
        const end = new Date(extent[1]);
        if (+start === +end) end.setDate(end.getDate() + 1);
        return [start, end];
    }
    const min = extent[0];
    const max = extent[1];
    if (min === max) return [min, min + 1];
    return [min, max];
}

function resolveMetricPreference(preferredKey, nodes) {
    const order = [];
    if (preferredKey && AXIS_METRICS[preferredKey]) {
        order.push(preferredKey);
    }
    Object.keys(AXIS_METRICS).forEach(key => {
        if (!order.includes(key)) order.push(key);
    });
    for (const key of order) {
        const domain = computeMetricDomain(key, nodes);
        if (domain) return { key, domain };
    }
    return null;
}

function buildScaleForMetric(metricKey, domain, range) {
    const def = AXIS_METRICS[metricKey];
    if (!def || !domain) return null;
    if (def.scaleType === "time") {
        return d3.scaleTime().domain(domain).range(range);
    }
    return d3.scaleLinear().domain(domain).range(range);
}

function getMetricValue(node, metricKey) {
    const def = AXIS_METRICS[metricKey];
    if (!def) return null;
    const raw = def.valueAccessor(node);
    if (raw == null) return null;
    if (def.scaleType === "time") {
        return new Date(raw);
    }
    return raw;
}

// --- Sankey Helpers (ported from river.js) ---
function normKey(value) {
    const str = (value ?? "").toString().trim();
    return str.length ? str : "Unknown";
}

function addToNestedCount(target, outerKey, innerKey, amount) {
    if (!target.has(outerKey)) target.set(outerKey, new Map());
    const inner = target.get(outerKey);
    inner.set(innerKey, (inner.get(innerKey) || 0) + amount);
}

function buildPaperCategoryCounts(rows, paperIdKey, categoryKey) {
    const out = new Map();
    rows.forEach(row => {
        const paperId = normKey(row[paperIdKey]);
        // Extract category (simple lookup for now, assumed flat CSV structure)
        const cat = normKey(row[categoryKey]);
        addToNestedCount(out, paperId, cat, 1);
    });
    return out;
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

function topKeysByValue(map, limit, alwaysInclude = []) {
    const entries = Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([k]) => k);
    const set = new Set(entries);
    alwaysInclude.forEach(k => set.add(k));
    return set;
}

function totalsForPapers(paperCounts, paperIds) {
    const totals = new Map();
    paperIds.forEach(id => {
        const m = paperCounts.get(id);
        totals.set(id, m ? sumByValues(m) : 0);
    });
    return totals;
}

function sumByValues(map) {
    let sum = 0;
    map.forEach(v => sum += v);
    return sum;
}
