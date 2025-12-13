const cocitationPanel = document.getElementById('cocitation-panel');
const bibliographicPanel = document.getElementById('bibliographic-panel');

// Shared metadata and configuration
let paperMeta = new Map();
let xAxisMetric = "date";
let yAxisMetric = "citation";
let nodeSizeMetric = "degree";
let nodeColorMetric = "none";
let positionStability = 1;

// Global data storage
let globalCocitationData = [];
let globalBibliographicData = [];
let selectedNodeIds = new Set();

const horizontalPadding = 80;
const axisNumberFormatter = d3.format(",");
const axisDateFormatter = d3.timeFormat("%Y-%m-%d");
const DEFAULT_NODE_COLOR = "#8EA2FF";
const READ_NODE_COLOR = "#4ADE80";
const DEFAULT_NODE_RADIUS = 10;
const COLOR_PALETTE = [
    "#6C8BFF", "#FF8A5B", "#4FD1C5", "#F97316", "#A855F7",
    "#10B981", "#F472B6", "#38BDF8", "#FACC15", "#EC4899",
    "#14B8A6", "#FBBF24", "#F87171", "#22D3EE", "#C084FC",
    "#F59E0B", "#34D399", "#FB7185", "#3B82F6", "#D946EF"
];
const NODE_SIZE_OPTIONS = new Set(["none", "degree", "weightedDegree", "citation"]);
const NODE_COLOR_OPTIONS = new Set(["none", "venue", "institution", "topic"]);

const AXIS_METRICS = {
    date: {
        label: "Publication Date",
        scaleType: "time",
        valueAccessor: node => node.dateValue ?? null,
        formatTick: axisDateFormatter
    },
    citation: {
        label: "Citation Count",
        scaleType: "linear",
        valueAccessor: node => node.cited ?? null,
        formatTick: axisNumberFormatter
    },
    cocitation: {
        label: "Co-citation Strength",
        scaleType: "linear",
        valueAccessor: node => node.weightedDegree ?? null,
        formatTick: axisNumberFormatter
    }
};

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

function buildSankeyData({
    readPaperIds,
    mainMeta,
    foundationsByPaper,
    audienceByPaper
}) {
    // 1. Identify Top Categories (Field) for Foundations (Left) and Audience (Right)
    const foundationTotals = aggregateCategoryTotals(foundationsByPaper, readPaperIds);
    const audienceTotals = aggregateCategoryTotals(audienceByPaper, readPaperIds);

    const maxCategories = 10;
    const topFoundationCats = topKeysByValue(foundationTotals, maxCategories, ["Unknown"]);
    const topAudienceCats = topKeysByValue(audienceTotals, maxCategories, ["Unknown"]);
    
    // Add "Other" if needed
    topFoundationCats.add("Other");
    topAudienceCats.add("Other");

    const nodes = [];
    const nodeIndex = new Map();
    const addNode = (node) => {
        if (nodeIndex.has(node.id)) return;
        nodeIndex.set(node.id, nodes.length);
        nodes.push(node);
    };

    // Left Nodes: Foundations
    Array.from(topFoundationCats).forEach(cat => {
        addNode({
            id: `F:${cat}`,
            name: cat,
            type: "foundation"
        });
    });

    // Middle Nodes: Read Papers
    readPaperIds.forEach(paperId => {
        const meta = mainMeta.get(paperId) || {};
        addNode({
            id: `P:${paperId}`,
            name: meta.title || paperId,
            type: "paper",
            paperId,
            primaryTopic: meta.primaryTopic
        });
    });

    // Right Nodes: Audience
    Array.from(topAudienceCats).forEach(cat => {
        addNode({
            id: `A:${cat}`,
            name: cat,
            type: "audience"
        });
    });

    const paperFoundationTotals = totalsForPapers(foundationsByPaper, readPaperIds);
    const paperAudienceTotals = totalsForPapers(audienceByPaper, readPaperIds);

    const linksAgg = new Map();
    const addLink = (sourceId, targetId, paperId, value) => {
        const key = `${sourceId}→${targetId}`;
        const prev = linksAgg.get(key);
        if (prev) prev.value += value;
        else linksAgg.set(key, { source: sourceId, target: targetId, value, paperId });
    };

    readPaperIds.forEach(paperId => {
        const fCounts = foundationsByPaper.get(paperId) || new Map();
        const aCounts = audienceByPaper.get(paperId) || new Map();
        const fTotal = paperFoundationTotals.get(paperId) || 0;
        const aTotal = paperAudienceTotals.get(paperId) || 0;

        // Foundation -> Paper
        fCounts.forEach((count, catRaw) => {
            const cat = topFoundationCats.has(catRaw) ? catRaw : "Other";
            // Use count directly (volume)
            addLink(`F:${cat}`, `P:${paperId}`, paperId, count);
        });

        // Paper -> Audience
        aCounts.forEach((count, catRaw) => {
            const cat = topAudienceCats.has(catRaw) ? catRaw : "Other";
            addLink(`P:${paperId}`, `A:${cat}`, paperId, count);
        });
    });

    const links = Array.from(linksAgg.values()).filter(l => nodeIndex.has(l.source) && nodeIndex.has(l.target));

    return { nodes, links };
}

class SankeyVisualizer {
    constructor(svgSelector, panelElement) {
        this.svg = d3.select(svgSelector);
        this.panel = panelElement;
        this.width = 0;
        this.height = 0;
        this.resizeObserver = null;
        this.resizeTimeout = null;
        this.refData = [];
        this.citData = [];
        
        this.setupResizeObserver();
    }

    setupResizeObserver() {
        this.resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.target === this.panel) {
                    if (this.resizeTimeout) cancelAnimationFrame(this.resizeTimeout);
                    this.resizeTimeout = requestAnimationFrame(() => {
                        this.updateDimensions();
                        this.updateGraph();
                        this.resizeTimeout = null;
                    });
                }
            }
        });
        this.resizeObserver.observe(this.panel);
    }

    updateDimensions() {
        const rect = this.panel.getBoundingClientRect();
        // Account for header if any
        this.width = rect.width;
        this.height = rect.height - 40; // Subtract header height approx
        this.svg.attr("width", this.width).attr("height", this.height);
    }

    setData(refData, citData) {
        this.refData = refData;
        this.citData = citData;
        this.updateGraph();
    }

    updateGraph() {
        if (this.width < 50 || this.height < 50) return;
        this.svg.selectAll("*").remove();

        // 1. Get Read Papers
        const readPaperIds = new Set();
        paperMeta.forEach((meta, id) => {
            if (meta.isRead) readPaperIds.add(id);
        });

        if (readPaperIds.size === 0) {
            this.svg.append("text")
                .attr("x", this.width/2)
                .attr("y", this.height/2)
                .attr("text-anchor", "middle")
                .attr("fill", "#666")
                .text("No read papers selected.");
            return;
        }

        // 2. Build Category Counts (Field)
        // references.csv: source_paper_id is Our Paper. paper_field is Foundation.
        const foundationsByPaper = buildPaperCategoryCounts(this.refData, "source_paper_id", "paper_field");
        // citation.csv: source_paper_id is Our Paper. paper_field is Audience.
        const audienceByPaper = buildPaperCategoryCounts(this.citData, "source_paper_id", "paper_field");

        // 3. Build Sankey Data
        const graphData = buildSankeyData({
            readPaperIds,
            mainMeta: paperMeta,
            foundationsByPaper,
            audienceByPaper
        });

        if (!graphData.nodes.length) return;

        // 4. Layout
        const sankey = d3.sankey()
            .nodeId(d => d.id)
            .nodeWidth(14)
            .nodePadding(12)
            .nodeAlign(d3.sankeyJustify)
            .extent([[10, 20], [this.width - 10, this.height - 10]]);

        let graph = null;
        try {
            graph = sankey({
                nodes: graphData.nodes.map(d => ({ ...d })),
                links: graphData.links.map(d => ({ ...d }))
            });
        } catch (e) {
            console.error("Sankey layout error:", e);
            return;
        }

        // 5. Render
        const COLORS = {
            foundation: "#94A3B8", // slate-400
            audience: "#C4B5FD",   // violet-300
            paper: "#4ADE80"       // green-400 (Read color)
        };

        const g = this.svg.append("g");

        // Links
        const link = g.append("g")
            .attr("fill", "none")
            .attr("stroke-opacity", 0.15)
            .selectAll("path")
            .data(graph.links)
            .join("path")
            .attr("d", d3.sankeyLinkHorizontal())
            .attr("stroke-width", d => Math.max(1, d.width))
            .attr("stroke", d => {
                 // Color by source node type usually, or static
                 return "#fff";
            })
            .style("mix-blend-mode", "screen");

        link.append("title")
            .text(d => `${d.source.name} → ${d.target.name}\n${d.value} connections`);

        // Nodes
        const node = g.append("g")
            .selectAll("rect")
            .data(graph.nodes)
            .join("rect")
            .attr("x", d => d.x0)
            .attr("y", d => d.y0)
            .attr("height", d => Math.max(1, d.y1 - d.y0))
            .attr("width", d => d.x1 - d.x0)
            .attr("fill", d => {
                if (d.type === "foundation") return COLORS.foundation;
                if (d.type === "audience") return COLORS.audience;
                return COLORS.paper;
            })
            .attr("opacity", 0.9);

        node.append("title")
            .text(d => `${d.name}\n${d.value}`);

        // Labels
        g.append("g")
            .attr("font-size", "10px")
            .attr("fill", "#ddd")
            .style("pointer-events", "none")
            .selectAll("text")
            .data(graph.nodes)
            .join("text")
            .attr("x", d => d.x0 < this.width / 2 ? d.x1 + 6 : d.x0 - 6)
            .attr("y", d => (d.y1 + d.y0) / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", d => d.x0 < this.width / 2 ? "start" : "end")
            .text(d => d.type === "paper" ? (d.name.length > 25 ? d.name.slice(0,25)+"..." : d.name) : d.name);
    }
    
    updateSelection(selectedSet) {
         // Optionally highlight papers in Sankey based on global selection
         // For now, we just leave it as showing all Read papers
    }
}

const sankeyPanel = document.getElementById('sankey-panel');
const sankeyGraph = new SankeyVisualizer("#sankey-svg", sankeyPanel);

class NetworkVisualizer {
    constructor(svgSelector, panelElement, strengthKey) {
        this.svg = d3.select(svgSelector);
        this.panel = panelElement;
        this.strengthKey = strengthKey;
        this.rawData = [];
        this.nodes = [];
        this.links = [];
        this.simulation = null;
        this.width = 0;
        this.height = 0;
        this.resizeObserver = null;
        this.resizeTimeout = null;
        
        this.setupSVG();
        this.setupResizeObserver();
    }

    setupResizeObserver() {
        this.resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.target === this.panel) {
                    if (this.resizeTimeout) cancelAnimationFrame(this.resizeTimeout);
                    this.resizeTimeout = requestAnimationFrame(() => {
                        this.updateDimensions();
                        this.updateGraph();
                        this.resizeTimeout = null;
                    });
                }
            }
        });
        this.resizeObserver.observe(this.panel);
    }

    updateSelection(selectedSet) {
        this.graphGroup.selectAll(".link").classed("highlighted", false);
        this.graphGroup.selectAll(".node").classed("selected", false);

        if (selectedSet.size === 0) return;

        this.graphGroup.selectAll(".link")
            .filter(l => selectedSet.has(l.sourceId) || selectedSet.has(l.targetId))
            .classed("highlighted", true);

        this.graphGroup.selectAll(".node")
            .filter(d => selectedSet.has(d.id))
            .classed("selected", true)
            .raise();
    }

    setupSVG() {
        const defs = this.svg.append("defs");
        const pat = defs.append("pattern")
            .attr("id", "yearStripePattern")
            .attr("patternUnits", "userSpaceOnUse")
            .attr("width", 8)
            .attr("height", 8)
            .attr("patternTransform", "rotate(45)");
        pat.append("rect")
            .attr("width", 8)
            .attr("height", 8)
            .attr("fill", "#1a1a1a");
        pat.append("rect")
            .attr("width", 4)
            .attr("height", 8)
            .attr("fill", "#2a2a2a");

        this.panZoomGroup = this.svg.append("g").attr("class", "panzoom-layer");
        this.rotateGroup = this.panZoomGroup.append("g").attr("class", "rotate-layer");
        this.graphGroup = this.rotateGroup.append("g").attr("class", "graph-layer");

        this.zoom = d3.zoom()
            .filter((event) => !event.ctrlKey)
            .scaleExtent([0.3, 5])
            .on("zoom", (event) => {
                this.panZoomGroup.attr("transform", event.transform);
            });

        this.svg.call(this.zoom);

        // Rotation logic
        let rotation = 0;
        let rotating = false;
        let startAngle = 0;
        let startRotation = 0;

        const angleFromCenter = (event) => {
            const t = d3.zoomTransform(this.svg.node());
            const [mx, my] = d3.pointer(event, this.svg.node());
            const scx = this.width / 2;
            const scy = this.height / 2;
            const cx = (scx - t.x) / t.k;
            const cy = (scy - t.y) / t.k;
            const wx = (mx - t.x) / t.k;
            const wy = (my - t.y) / t.k;
            return {
                angleDeg: Math.atan2(wy - cy, wx - cx) * 180 / Math.PI,
                cx, cy
            };
        }

        this.svg.on("pointerdown", (event) => {
            if (event.ctrlKey && event.button === 0) {
                rotating = true;
                const a = angleFromCenter(event);
                startAngle = a.angleDeg;
                startRotation = rotation;
                this.svg.style("cursor", "grabbing");
                event.preventDefault();
            }
        });

        this.svg.on("pointermove", (event) => {
            if (!rotating) return;
            const a = angleFromCenter(event);
            rotation = startRotation + (a.angleDeg - startAngle);
            this.rotateGroup.attr(
                "transform",
                `translate(${a.cx},${a.cy}) rotate(${rotation}) translate(${-a.cx},${-a.cy})`
            );
        });

        this.svg.on("pointerup pointerleave", () => {
            if (!rotating) return;
            rotating = false;
            this.svg.style("cursor", null);
        });

        this.svg.on("click", (event) => {
            if (event.target.tagName === "svg") {
                handleGlobalClear();
            }
        });
    }

    updateDimensions() {
        const rect = this.panel.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        this.svg.attr("width", this.width).attr("height", this.height);
    }

    setData(data) {
        this.rawData = data;
        this.updateGraph();
    }

    updateGraph() {
        if (this.simulation) {
            this.simulation.stop();
            this.simulation = null;
        }

        this.graphGroup.selectAll("*").remove();

        if (this.width < 10 || this.height < 10) return;

        const allNodeIds = new Set(paperMeta.keys());
        this.rawData.forEach(d => {
            allNodeIds.add(d.paper1);
            allNodeIds.add(d.paper2);
        });

        const nodes = Array.from(allNodeIds).map(id => {
            const meta = paperMeta.get(id) || {};
            return {
                id,
                year: meta.year,
                cited: meta.cited,
                dateValue: meta.dateValue,
                date: meta.date,
                institution: meta.institution,
                venue: meta.venue,
                primaryTopic: meta.primaryTopic,
                isRead: meta.isRead
            };
        });

        if (nodes.length === 0) {
            this.nodes = [];
            this.links = [];
            return;
        }

        const nodesById = new Map(nodes.map(node => [node.id, node]));

        const filteredLinks = this.rawData.filter(d =>
            allNodeIds.has(d.paper1) && allNodeIds.has(d.paper2)
        );
        const links = filteredLinks.map(d => ({
            source: d.paper1,
            target: d.paper2,
            sourceId: d.paper1,
            targetId: d.paper2,
            strength: +d[this.strengthKey]
        })).filter(l => nodesById.has(l.sourceId) && nodesById.has(l.targetId));

        this.nodes = nodes;
        this.links = links;
        const nodeMetrics = new Map();

        const addMetric = (id, strength) => {
            const metric = nodeMetrics.get(id) || { degree: 0, weightedDegree: 0 };
            metric.degree += 1;
            metric.weightedDegree += strength;
            nodeMetrics.set(id, metric);
        };

        links.forEach(link => {
            addMetric(link.sourceId, link.strength);
            addMetric(link.targetId, link.strength);
        });

        nodes.forEach(node => {
            const metric = nodeMetrics.get(node.id) || { degree: 0, weightedDegree: 0 };
            node.degree = metric.degree;
            node.weightedDegree = metric.weightedDegree;
        });

        const strengthExtent = links.length ? d3.extent(links, d => d.strength) : [0, 1];
        const widthScale = d3.scaleLinear()
            .domain(strengthExtent)
            .range([0.1, 0.6]);

        const horizontalRange = [horizontalPadding, Math.max(horizontalPadding + 10, this.width - horizontalPadding)];
        const verticalRange = [this.height - 80, 40];

        const xMetricInfo = resolveMetricPreference(xAxisMetric, nodes);
        const yMetricInfo = resolveMetricPreference(yAxisMetric, nodes);

        if (!xMetricInfo || !yMetricInfo) {
            this.svg.call(this.zoom.transform, d3.zoomIdentity);
            return;
        }

        const xScale = buildScaleForMetric(xMetricInfo.key, xMetricInfo.domain, horizontalRange);
        const yScale = buildScaleForMetric(yMetricInfo.key, yMetricInfo.domain, verticalRange);

        if (!xScale || !yScale) {
            this.svg.call(this.zoom.transform, d3.zoomIdentity);
            return;
        }

        const xDefault = xMetricInfo.domain[0];
        const yDefault = yMetricInfo.domain[0];

        nodes.forEach(node => {
            const xValue = getMetricValue(node, xMetricInfo.key);
            const yValue = getMetricValue(node, yMetricInfo.key);
            node.targetX = xScale(xValue != null ? xValue : xDefault);
            node.targetY = yScale(yValue != null ? yValue : yDefault);
            node.x = node.targetX;
            node.y = node.targetY;
        });

        let radiusScale = null;
        if (nodeSizeMetric !== "none") {
            const sizeValues = nodes
                .map(node => {
                    const val = getNodeSizeValue(node, nodeSizeMetric);
                    return Number.isFinite(val) ? val : null;
                })
                .filter(v => v != null);

            if (sizeValues.length > 0) {
                const extent = d3.extent(sizeValues);
                const minSize = extent[0];
                const maxSize = extent[1] === extent[0] ? extent[0] + 1 : extent[1];
                radiusScale = d3.scaleSqrt()
                    .domain([minSize, maxSize])
                    .range([3, 14]);
            }
        }

        let colorScale = null;
        if (nodeColorMetric !== "none") {
            const colorValues = nodes
                .map(node => getNodeColorValue(node, nodeColorMetric))
                .filter(v => v != null);

            if (colorValues.length > 0) {
                const unique = Array.from(new Set(colorValues));
                colorScale = d3.scaleOrdinal()
                    .domain(unique)
                    .range(buildColorRange(unique.length));
            }
        }

        const radiusForNode = (node) => {
            if (!radiusScale || nodeSizeMetric === "none") return DEFAULT_NODE_RADIUS;
            const value = getNodeSizeValue(node, nodeSizeMetric);
            if (value == null) return DEFAULT_NODE_RADIUS;
            return radiusScale(value);
        };

        const fillForNode = (node) => {
            if (node.isRead) return READ_NODE_COLOR;
            if (!colorScale || nodeColorMetric === "none") return DEFAULT_NODE_COLOR;
            const value = getNodeColorValue(node, nodeColorMetric);
            if (!value) return DEFAULT_NODE_COLOR;
            return colorScale(value);
        };

        const gridLayer = this.graphGroup.append("g").attr("class", "grid-layer");

        const yRange = yScale.range();
        const yMin = Math.min(...yRange);
        const yMax = Math.max(...yRange);
        const xRange = xScale.range();
        const xMin = Math.min(...xRange);
        const xMax = Math.max(...xRange);
        const centerX = (xMin + xMax) / 2;
        const centerY = (yMin + yMax) / 2;

        const xMetricDef = AXIS_METRICS[xMetricInfo.key];
        const yMetricDef = AXIS_METRICS[yMetricInfo.key];
        const xFormatter = xMetricDef.formatTick || (d => d);
        const yFormatter = yMetricDef.formatTick || (d => d);

        const xTicks = typeof xScale.ticks === "function" ? xScale.ticks(10) : xScale.domain();
        gridLayer.append("g")
            .attr("class", "grid-vertical")
            .selectAll("line")
            .data(xTicks)
            .join("line")
            .attr("class", "grid-line vertical")
            .attr("x1", d => xScale(d))
            .attr("x2", d => xScale(d))
            .attr("y1", yMin - 20)
            .attr("y2", yMax + 20);

        const xLabelGroup = gridLayer.append("g")
            .attr("class", "grid-date-labels")
            .selectAll("text")
            .data(xTicks)
            .join("text")
            .attr("class", "grid-label grid-label-x")
            .attr("x", d => xScale(d))
            .attr("y", yMax + 25)
            .text(d => xFormatter(d));

        if (xMetricDef.scaleType === "time") {
            xLabelGroup.attr("transform", d => `rotate(-45, ${xScale(d)}, ${yMax + 35})`);
        } else {
            xLabelGroup.attr("transform", null);
        }

        const yTicks = typeof yScale.ticks === "function" ? yScale.ticks(10) : yScale.domain();
        gridLayer.append("g")
            .attr("class", "grid-horizontal")
            .selectAll("line")
            .data(yTicks)
            .join("line")
            .attr("class", "grid-line horizontal")
            .attr("y1", d => yScale(d))
            .attr("y2", d => yScale(d))
            .attr("x1", xMin - 30)
            .attr("x2", xMax + 30);

        gridLayer.append("g")
            .attr("class", "grid-citation-labels")
            .selectAll("text")
            .data(yTicks)
            .join("text")
            .attr("class", "grid-label grid-label-y")
            .attr("x", xMin - 40)
            .attr("y", d => yScale(d))
            .attr("dy", "0.32em")
            .text(d => yFormatter(d));

        const link = this.graphGroup.append("g")
            .attr("class", "links-layer")
            .selectAll("path")
            .data(links)
            .join("path")
            .attr("class", "link")
            .attr("fill", "none")
            .attr("stroke-width", d => widthScale(d.strength))
            .attr("d", d => {
                const sx = nodesById.get(d.sourceId).x;
                const sy = nodesById.get(d.sourceId).y;
                const tx = nodesById.get(d.targetId).x;
                const ty = nodesById.get(d.targetId).y;
                const dx = tx - sx;
                const dy = ty - sy;
                const dr = Math.sqrt(dx * dx + dy * dy);
                return `M${sx},${sy}A${dr},${dr} 0 0,1 ${tx},${ty}`;
            });

        const node = this.graphGroup.append("g")
            .attr("class", "nodes-layer")
            .selectAll("circle")
            .data(nodes)
            .join("circle")
            .attr("class", "node")
            .attr("r", d => radiusForNode(d))
            .attr("fill", d => fillForNode(d))
            .attr("cx", d => d.x)
            .attr("cy", d => d.y)
            .on("click", (event, d) => {
                handleGlobalNodeClick(event, d);
            });

        const formatDate = d3.timeFormat("%Y-%m-%d");
        node.append("title")
            .text(d => {
                const parts = [];
                if (d.date) parts.push(formatDate(d.date));
                if (d.cited != null) parts.push(`cited_by: ${d.cited}`);
                if (d.degree != null) parts.push(`degree: ${d.degree}`);
                if (d.weightedDegree != null) parts.push(`weighted_degree: ${d.weightedDegree}`);
                if (d.venue) parts.push(`venue: ${d.venue}`);
                if (d.institution) parts.push(`institution: ${d.institution}`);
                return [d.id, ...parts].join(" • ");
            });

        const axisWeight = Math.max(0, Math.min(1, positionStability));
        const forceWeight = 1 - axisWeight;

        if (forceWeight > 0) {
            const linkForceStrength = 1.6 * forceWeight;
            const chargeStrength = -30 * forceWeight;
            const collisionStrength = 0.9 * forceWeight;

            this.simulation = d3.forceSimulation(nodes)
                .force("link", d3.forceLink(links)
                    .id(d => d.id)
                    .distance(300)
                    .strength(linkForceStrength))
                .force("charge", d3.forceManyBody().strength(chargeStrength))
                .force("collision", d3.forceCollide(d => radiusForNode(d) + 4).strength(collisionStrength))
                .force("x", d3.forceX(d => d.targetX).strength(0.6 * axisWeight))
                .force("y", d3.forceY(d => d.targetY).strength(0.6 * axisWeight))
                .force("center", d3.forceCenter(centerX, centerY).strength(0.5 * forceWeight))
                .alpha(0.9)
                .alphaDecay(0.05)
                .on("tick", () => {
                    node
                        .attr("cx", d => d.x)
                        .attr("cy", d => d.y);

                    link.attr("d", d => {
                        const dx = d.target.x - d.source.x;
                        const dy = d.target.y - d.source.y;
                        const dr = Math.sqrt(dx * dx + dy * dy);
                        return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
                    });
                })
                .on("end", () => {
                    this.simulation = null;
                });
        } else {
            this.simulation = null;
        }

        this.svg.call(this.zoom.transform, d3.zoomIdentity);
        
        if (this.svg.attr("id") === "graph-svg") {
             document.getElementById('node-count').textContent = nodes.length.toLocaleString();
             if (links.length > 0 && strengthExtent && strengthExtent[0] != null && strengthExtent[1] != null) {
                document.getElementById('strength-range').textContent = `${strengthExtent[0]} - ${strengthExtent[1]}`;
            } else {
                document.getElementById('strength-range').textContent = "-";
            }
        }
        
        // Apply current selection to newly rendered graph
        this.updateSelection(selectedNodeIds);
    }
}

const cocitationGraph = new NetworkVisualizer("#graph-svg", cocitationPanel, "cocitation_strength");
const bibliographicGraph = new NetworkVisualizer("#bibliographic-svg", bibliographicPanel, "coupling_strength");

function handleGlobalNodeClick(event, d) {
    event.stopPropagation();
    const nodeId = d.id;
    if (selectedNodeIds.has(nodeId)) {
        selectedNodeIds.delete(nodeId);
    } else {
        selectedNodeIds.add(nodeId);
    }
    updateAllSelections();
}

function handleGlobalClear() {
    selectedNodeIds.clear();
    updateAllSelections();
}

function updateAllSelections() {
    graphs.forEach(g => g.updateSelection(selectedNodeIds));
    updateAnalyticsSelection();
    updateAnalytics(currentAnalyticsMode);
}

function updateAnalyticsSelection() {
    // Only update heatmap selection visuals
    const container = d3.select(".heatmap-container");
    container.classed("has-selection", selectedNodeIds.size > 0);
    container.selectAll(".heatmap-cell")
        .classed("highlighted", d => selectedNodeIds.has(d.unreadId));
}

const graphs = [cocitationGraph, bibliographicGraph, sankeyGraph];

function updateAllGraphs() {
    graphs.forEach(g => {
        g.updateDimensions();
        g.updateGraph();
    });
}

function setAxisMetric(axis, value) {
    if (!AXIS_METRICS[value]) return;
    if (axis === "x") {
        xAxisMetric = value;
    } else if (axis === "y") {
        yAxisMetric = value;
    }
}

function setupControls() {
    const xSelect = document.getElementById('x-axis-select');
    const ySelect = document.getElementById('y-axis-select');
    if (xSelect) {
        xSelect.value = xAxisMetric;
        xSelect.addEventListener('change', (event) => {
            setAxisMetric("x", event.target.value);
            updateAllGraphs();
        });
    }
    if (ySelect) {
        ySelect.value = yAxisMetric;
        ySelect.addEventListener('change', (event) => {
            setAxisMetric("y", event.target.value);
            updateAllGraphs();
        });
    }
    const nodeSizeSelect = document.getElementById('node-size-select');
    if (nodeSizeSelect) {
        nodeSizeSelect.value = nodeSizeMetric;
        nodeSizeSelect.addEventListener('change', (event) => {
            const value = event.target.value;
            if (!NODE_SIZE_OPTIONS.has(value)) return;
            nodeSizeMetric = value;
            updateAllGraphs();
        });
    }
    const nodeColorSelect = document.getElementById('node-color-select');
    if (nodeColorSelect) {
        nodeColorSelect.value = nodeColorMetric;
        nodeColorSelect.addEventListener('change', (event) => {
            const value = event.target.value;
            if (!NODE_COLOR_OPTIONS.has(value)) return;
            nodeColorMetric = value;
            updateAllGraphs();
        });
    }
    const stabilitySlider = document.getElementById('stability-slider');
    const stabilityValue = document.getElementById('stability-value');
    if (stabilitySlider && stabilityValue) {
        stabilitySlider.value = positionStability;
        stabilityValue.textContent = positionStability.toFixed(2);
        stabilitySlider.addEventListener('input', (event) => {
            positionStability = parseFloat(event.target.value);
            stabilityValue.textContent = positionStability.toFixed(2);
            updateAllGraphs();
        });
    }
}

setupControls();

function setupPanelToggle() {
    const toggleBtn = document.getElementById('toggle-panels-btn');
    const sidePanel = document.querySelector('.side-panel');
    const analyticsPanel = document.querySelector('.analytics-panel');
    const appContainer = document.getElementById('app-container');

    if (!toggleBtn || !sidePanel || !analyticsPanel || !appContainer) return;

    let panelsHidden = false;

    toggleBtn.addEventListener('click', () => {
        panelsHidden = !panelsHidden;

        if (panelsHidden) {
            sidePanel.classList.add('hidden');
            analyticsPanel.classList.add('hidden');
            appContainer.classList.add('panels-hidden');
            toggleBtn.classList.add('panels-hidden');
        } else {
            sidePanel.classList.remove('hidden');
            analyticsPanel.classList.remove('hidden');
            appContainer.classList.remove('panels-hidden');
            toggleBtn.classList.remove('panels-hidden');
        }
        
        if (window.updateAppLayout) {
            window.updateAppLayout();
        }
    });
}

setupPanelToggle();

function setupDragAndDrop() {
    const draggables = document.querySelectorAll('.draggable-item');
    const dropZones = document.querySelectorAll('.drop-zone');
    const sourceContainer = document.querySelector('.draggable-source');
    
    // Map data-type to panel IDs
    const panelMap = {
        'cocitation': 'cocitation-panel',
        'bibliographic': 'bibliographic-panel',
        'sankey': 'sankey-panel'
    };

    let draggedItem = null;

    draggables.forEach(draggable => {
        draggable.addEventListener('dragstart', () => {
            draggedItem = draggable;
            draggable.classList.add('dragging');
        });

        draggable.addEventListener('dragend', () => {
            draggable.classList.remove('dragging');
            draggedItem = null;
        });
    });

    dropZones.forEach(zone => {
        zone.addEventListener('dragover', e => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            
            if (!draggedItem) return;

            // If zone has an item, move it back to source
            const existingItem = zone.querySelector('.draggable-item');
            if (existingItem) {
                sourceContainer.appendChild(existingItem);
            }

            zone.appendChild(draggedItem);
            updateLayoutFromDrop();
        });
    });

    // Also allow dropping back to source
    sourceContainer.addEventListener('dragover', e => {
        e.preventDefault();
    });

    sourceContainer.addEventListener('drop', e => {
        e.preventDefault();
        if (draggedItem) {
            sourceContainer.appendChild(draggedItem);
            updateLayoutFromDrop();
        }
    });

    window.updateAppLayout = updateLayoutFromDrop;

    function updateLayoutFromDrop() {
        const zone1Item = document.querySelector('.drop-zone[data-zone="1"] .draggable-item');
        const zone2Item = document.querySelector('.drop-zone[data-zone="2"] .draggable-item');
        
        const panel1Id = zone1Item ? panelMap[zone1Item.dataset.type] : null;
        const panel2Id = zone2Item ? panelMap[zone2Item.dataset.type] : null;

        const appContainer = document.getElementById('app-container');
        const panels = ['cocitation-panel', 'bibliographic-panel', 'sankey-panel'];
        
        // Reset all panels
        panels.forEach(id => {
            const el = document.getElementById(id);
            if(el) {
                el.classList.add('hidden');
                el.style.gridColumn = 'auto'; // Reset grid column
            }
        });

        // Configure Layout
        // Default Grid: 320px 1fr 1fr 360px
        // We need to adjust columns based on visibility
        
        let gridTemplate = "320px ";
        
        // Panel 1
        if (panel1Id) {
            const p1 = document.getElementById(panel1Id);
            p1.classList.remove('hidden');
            p1.style.gridColumn = "2"; // Explicitly place in View 1 column
            gridTemplate += "1fr ";
        } else {
             gridTemplate += "0fr "; // Collapse
        }

        // Panel 2
        if (panel2Id) {
             const p2 = document.getElementById(panel2Id);
             p2.classList.remove('hidden');
             p2.style.gridColumn = "3"; // Explicitly place in View 2 column
             gridTemplate += "1fr ";
        } else {
             gridTemplate += "0fr ";
        }

        gridTemplate += "360px";

        // Remove order properties as we are using explicit grid columns now
        if (panel1Id) document.getElementById(panel1Id).style.order = "";
        if (panel2Id) document.getElementById(panel2Id).style.order = "";
        
        // Analytics panel is forced to order 999 in CSS.
        
        // Apply Grid Template
        if (!appContainer.classList.contains('panels-hidden')) {
            appContainer.style.gridTemplateColumns = gridTemplate;
        } else {
            // If panels hidden, we preserve the 0fr logic for main content? 
            // Actually if panels hidden, side/analytics are 0px.
            // The middle parts should probably expand?
            // Existing logic: 0px 1fr 1fr 0px
            
            let hiddenTemplate = "0px ";
            hiddenTemplate += panel1Id ? "1fr " : "0fr ";
            hiddenTemplate += panel2Id ? "1fr " : "0fr ";
            hiddenTemplate += "0px";
            appContainer.style.gridTemplateColumns = hiddenTemplate;
        }
        
        // Also update ResizeObserver for graphs
         setTimeout(() => {
            updateAllGraphs();
        }, 450); // Wait for transition
    }

    // Initial Setup: Place Co-citation in Zone 1, Bibliographic in Zone 2
    const cocitationItem = sourceContainer.querySelector('[data-type="cocitation"]');
    const bioItem = sourceContainer.querySelector('[data-type="bibliographic"]');
    const zone1 = document.querySelector('.drop-zone[data-zone="1"]');
    const zone2 = document.querySelector('.drop-zone[data-zone="2"]');

    if (cocitationItem && zone1) zone1.appendChild(cocitationItem);
    if (bioItem && zone2) zone2.appendChild(bioItem);

    // Initial Layout Update
    updateLayoutFromDrop();
}

setupDragAndDrop();

let currentAnalyticsMode = "both";

function setupAnalyticsControls() {
    const buttons = document.querySelectorAll('.rank-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            buttons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const mode = e.target.dataset.mode;
            currentAnalyticsMode = mode;
            updateAnalytics(mode);
        });
    });
}

Promise.all([
    d3.csv("data/cocitation_network.csv"),
    d3.csv("data/bibliographic_coupling_network.csv"),
    d3.csv("data/main_papers.csv"),
    d3.csv("data/references.csv"),
    d3.csv("data/citation.csv")
]).then(([cocitationData, bibliographicData, metaData, refData, citData]) => {

    metaData.forEach(row => {
        const cited = row.cited_by_count ? +row.cited_by_count : undefined;
        const parsedDate = row.publication_date ? Date.parse(row.publication_date) : undefined;
        const validDate = Number.isFinite(parsedDate) ? new Date(parsedDate) : undefined;
        const yr = validDate ? validDate.getFullYear() : undefined;
        const institution = row.first_institution ? row.first_institution.trim() : undefined;
        const venue = row.venue ? row.venue.trim() : undefined;
        const primaryTopic = row.primary_topic ? row.primary_topic.trim() : undefined;
        const isRead = row.read ? +row.read === 1 : false;
        const title = row.title ? row.title.trim() : "Untitled";
        paperMeta.set(row.id, {
            year: yr,
            cited,
            date: validDate,
            dateValue: validDate ? validDate.getTime() : undefined,
            institution,
            venue,
            primaryTopic,
            isRead,
            title
        });
    });

    globalCocitationData = cocitationData;
    globalBibliographicData = bibliographicData;

    cocitationGraph.setData(cocitationData);
    bibliographicGraph.setData(bibliographicData);
    sankeyGraph.setData(refData, citData);
    
    updateAllGraphs();
    setupAnalyticsControls();
    updateAnalytics("both");

}).catch(error => {
    console.error("Error loading CSVs:", error);
});

function updateAnalytics(mode = "both") {
    // 1. Build Adjacency Map for current mode
    const adjacency = new Map();
    const addEdge = (p1, p2, w) => {
        if (isNaN(w)) return;
        if (!adjacency.has(p1)) adjacency.set(p1, new Map());
        if (!adjacency.has(p2)) adjacency.set(p2, new Map());
        adjacency.get(p1).set(p2, (adjacency.get(p1).get(p2) || 0) + w);
        adjacency.get(p2).set(p1, (adjacency.get(p2).get(p1) || 0) + w);
    };

    if (mode === "cocitation" || mode === "both") {
        globalCocitationData.forEach(d => addEdge(d.paper1, d.paper2, +d.cocitation_strength));
    }
    if (mode === "coupling" || mode === "both") {
        globalBibliographicData.forEach(d => addEdge(d.paper1, d.paper2, +d.coupling_strength));
    }

    // 2. Identify Read and Unread Papers
    const readPapers = [];
    const unreadPapers = [];
    const readPaperIds = new Set();

    for (const [id, meta] of paperMeta.entries()) {
        if (meta.isRead) {
            readPapers.push({ id, title: meta.title });
            readPaperIds.add(id);
        } else {
            // Score for top 10 (still used for heatmap columns)
            let score = 0;
            if (adjacency.has(id)) {
                for (const w of adjacency.get(id).values()) {
                    score += w;
                }
            }
            unreadPapers.push({ id, title: meta.title, score });
        }
    }

    unreadPapers.sort((a, b) => b.score - a.score);
    const top10 = unreadPapers.slice(0, 10);

    // 3. Prepare DOM
    const panel = d3.select(".analytics-panel");
    panel.selectAll(".paper-list").remove();
    panel.selectAll(".heatmap-container").remove();
    panel.selectAll(".charts-grid").remove(); // Legacy cleanup
    panel.selectAll(".heatmap-legend").remove();
    panel.selectAll(".stability-chart-container").remove();

    // 4. Render Heatmap if we have read papers and results
    if (readPapers.length > 0 && top10.length > 0) {
        const heatmapContainer = panel.append("div").attr("class", "heatmap-container");
        
        // Calculate matrix: rows = read papers, cols = top 10 unread
        const matrix = [];
        let maxVal = 0;

        readPapers.forEach(read => {
            const row = { paper: read, values: [], totalStrength: 0 };
            top10.forEach(unread => {
                let w = 0;
                if (adjacency.has(read.id) && adjacency.get(read.id).has(unread.id)) {
                    w = adjacency.get(read.id).get(unread.id);
                }
                row.totalStrength += w;
                row.values.push({
                    readId: read.id,
                    readTitle: read.title,
                    unreadId: unread.id,
                    unreadTitle: unread.title,
                    value: w
                });
                if (w > maxVal) maxVal = w;
            });
            matrix.push(row);
        });

        // Sort rows by total strength descending
        matrix.sort((a, b) => b.totalStrength - a.totalStrength);

        const containerNode = heatmapContainer.node();
        const totalWidth = containerNode ? containerNode.getBoundingClientRect().width : 300;
        const margin = { top: 20, right: 0, bottom: 0, left: 0 };
        
        const cellSize = Math.floor((totalWidth - margin.left - margin.right) / 10);
        const height = matrix.length * cellSize + margin.top + margin.bottom;

        const svg = heatmapContainer.append("svg")
            .attr("width", totalWidth)
            .attr("height", height);

        const g = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Column labels (1..10)
        g.selectAll(".col-label")
            .data(top10)
            .join("text")
            .attr("class", "heatmap-axis-label")
            .attr("x", (d, i) => i * cellSize + cellSize / 2)
            .attr("y", -5)
            .style("text-anchor", "middle")
            .text((d, i) => i + 1);

        const colorScale = d3.scaleSequential(d3.interpolateViridis)
            .domain([0, maxVal || 1]); 

        // Create tooltip div if not exists
        let tooltip = d3.select("body").select(".heatmap-tooltip");
        if (tooltip.empty()) {
            tooltip = d3.select("body").append("div")
                .attr("class", "heatmap-tooltip")
                .style("opacity", 0);
        }

        matrix.forEach((row, i) => {
            g.selectAll(`.cell-row-${i}`)
                .data(row.values)
                .join("rect")
                .attr("class", "heatmap-cell")
                .attr("x", (d, j) => j * cellSize)
                .attr("y", i * cellSize)
                .attr("width", cellSize - 1)
                .attr("height", cellSize - 1)
                .attr("fill", d => d.value === 0 ? "#333" : colorScale(d.value))
                .on("mouseover", (event, d) => {
                    tooltip.transition().duration(200).style("opacity", 1);
                    tooltip.html(`
                        <div><b>Read:</b> ${d.readTitle}</div>
                        <div><b>Rec:</b> ${d.unreadTitle}</div>
                        <div><b>Strength:</b> ${d.value}</div>
                    `)
                    .style("left", (event.pageX + 10) + "px")
                    .style("top", (event.pageY - 28) + "px");
                })
                .on("mouseout", () => {
                    tooltip.transition().duration(500).style("opacity", 0);
                })
                .on("click", (event, d) => {
                    handleGlobalNodeClick(event, {id: d.unreadId}); 
                });
        });

        // Legend
        const legendContainer = panel.append("div").attr("class", "heatmap-legend");
        const legendWidth = totalWidth - margin.left - margin.right;
        const legendHeight = 10;
        const legendSvg = legendContainer.append("svg")
            .attr("width", totalWidth)
            .attr("height", 30);
        
        const defs = legendSvg.append("defs");
        const linearGradient = defs.append("linearGradient")
            .attr("id", "linear-gradient");
        
        linearGradient
            .attr("x1", "0%")
            .attr("y1", "0%")
            .attr("x2", "100%")
            .attr("y2", "0%");
        
        for (let i = 0; i <= 10; i++) {
            const offset = i / 10;
            linearGradient.append("stop")
                .attr("offset", (offset * 100) + "%")
                .attr("stop-color", d3.interpolateViridis(offset));
        }
        
        const legendG = legendSvg.append("g")
            .attr("transform", `translate(${margin.left}, 0)`);

        legendG.append("rect")
            .attr("width", legendWidth)
            .attr("height", legendHeight)
            .style("fill", "url(#linear-gradient)");

        legendG.append("text")
            .attr("class", "heatmap-axis-label")
            .attr("x", 0)
            .attr("y", legendHeight + 12)
            .style("text-anchor", "start")
            .text("0");
            
        legendG.append("text")
            .attr("class", "heatmap-axis-label")
            .attr("x", legendWidth)
            .attr("y", legendHeight + 12)
            .style("text-anchor", "end")
            .text(maxVal);
    }

    // 5. Bootstrap Stability for Selected Papers
    // "Repeatedly subsample references.csv (or citation.csv) rows and recompute... score-to-read"
    // We simulate this by perturbing the edge weights (representing shared refs or citations)
    // using a Binomial(w, p) approximation.

    const targetPapers = [];
    if (selectedNodeIds.size > 0) {
        unreadPapers.forEach(p => {
            if (selectedNodeIds.has(p.id)) {
                targetPapers.push(p);
            }
        });
    }

    // Only render stability chart if we have selected papers
    // if (targetPapers.length === 0) {
    //     updateAnalyticsSelection();
    //     return;
    // }

    const nBootstrap = 50;
    const subsampleRate = 0.8;
    // We re-rank the entire pool to ensure correct rank for any selected paper
    const candidatePool = unreadPapers; 
    const rankDistributions = new Map();
    targetPapers.forEach(p => rankDistributions.set(p.id, []));

    if (targetPapers.length > 0) {
        for (let i = 0; i < nBootstrap; i++) {
            // Calculate perturbed scores
            const currentScores = [];
            
            for (const p of candidatePool) {
                let perturbedScore = 0;
                if (adjacency.has(p.id)) {
                    for (const w of adjacency.get(p.id).values()) {
                        // Simulate Binomial(n=w, p=subsampleRate)
                        // Using Normal approximation for performance: N(w*p, w*p*(1-p))
                        if (w > 0) {
                            const mean = w * subsampleRate;
                            const variance = w * subsampleRate * (1 - subsampleRate);
                            const std = Math.sqrt(variance);
                            // Box-Muller transform for Gaussian noise
                            const u1 = Math.random();
                            const u2 = Math.random();
                            const z = Math.sqrt(-2.0 * Math.log(u1 || 1e-9)) * Math.cos(2.0 * Math.PI * u2);
                            perturbedScore += Math.max(0, mean + z * std);
                        }
                    }
                }
                currentScores.push({ id: p.id, score: perturbedScore });
            }

            // Sort descending
            currentScores.sort((a, b) => b.score - a.score);

            // Record rank (1-based)
            currentScores.forEach((item, index) => {
                if (rankDistributions.has(item.id)) {
                    rankDistributions.get(item.id).push(index + 1);
                }
            });
        }
    }

    // Prepare Box Plot Data
	    const boxData = targetPapers.map(p => {
	        const ranks = rankDistributions.get(p.id);
	        ranks.sort((a, b) => a - b);
	        return {
	            id: p.id,
	            title: p.title,
	            min: ranks[0],
	            q1: d3.quantile(ranks, 0.25),
	            median: d3.quantile(ranks, 0.5),
	            q3: d3.quantile(ranks, 0.75),
	            max: ranks[ranks.length - 1]
	        };
	    });

	    const stabContainer = panel.append("div").attr("class", "stability-chart-container");
	    stabContainer.append("div")
	        .style("font-size", "13px")
	        .style("font-weight", "650")
	        .style("color", "rgba(226, 232, 240, 0.9)")
	        .style("margin-bottom", "8px")
	        .style("padding-top", "12px")
	        .style("text-align", "center")
	        .text("Stability of Selected Papers (Bootstrap Ranks)");

	    const stabNode = stabContainer.node();
	    const measuredStabWidth = stabNode ? stabNode.getBoundingClientRect().width : 0;
	    const stabWidth = Math.max(320, measuredStabWidth || 0);
	    const stabHeight = Math.max(250, 100 + (targetPapers.length || 1) * 20);
	    const stabMargin = { top: 22, right: 18, bottom: 44, left: 44 };
	    const stabInnerWidth = stabWidth - stabMargin.left - stabMargin.right;
	    const stabInnerHeight = stabHeight - stabMargin.top - stabMargin.bottom;

	    const stabSvg = stabContainer.append("svg")
	        .attr("width", stabWidth)
	        .attr("height", stabHeight);

    const gStab = stabSvg.append("g")
        .attr("transform", `translate(${stabMargin.left},${stabMargin.top})`);

	    // Y Axis: The Selected Papers (categorical)
	    // We list them 1..N
	    const yStab = d3.scaleBand()
	        .domain(targetPapers.map((d, i) => i)) // use index 0..N-1
	        .range([0, stabInnerHeight])
	        .padding(0.2);

	    // X Axis: Rank (1 to 50)
	    // We want rank 1 on the LEFT.
	    const maxObservedRank = d3.max(boxData, d => d.max) || 10;
	    const xDomainMax = Math.max(15, maxObservedRank);
	    const xStab = d3.scaleLinear()
	        .domain([1, xDomainMax]) // Ensure at least a bit of spread shown
	        .range([0, stabInnerWidth]);
	    const xTickCount = Math.max(4, Math.floor(stabInnerWidth / 70));

	    // Gridlines
	    const stabGrid = gStab.append("g")
	        .attr("class", "grid-lines")
	        .attr("transform", `translate(0,${stabInnerHeight})`)
	        .call(d3.axisBottom(xStab).ticks(xTickCount).tickSize(-stabInnerHeight).tickFormat(""));
	    stabGrid.selectAll("line")
	        .attr("stroke", "#94a3b8")
	        .attr("stroke-opacity", 0.14);
	    stabGrid.selectAll("path").remove();

	    // X Axis
	    const stabXAxis = gStab.append("g")
	        .attr("transform", `translate(0,${stabInnerHeight})`)
	        .call(d3.axisBottom(xStab).ticks(xTickCount));
	    stabXAxis.selectAll("text")
	        .attr("fill", "#888")
	        .style("font-size", "10px");
	    stabXAxis.selectAll("path, line")
	        .attr("stroke", "#444");
	
	    gStab.append("text")
	        .attr("x", stabInnerWidth / 2)
	        .attr("y", stabInnerHeight + 34)
	        .attr("fill", "#888")
	        .style("text-anchor", "middle")
	        .style("font-size", "10px")
	        .text("Rank (lower is better)");

	    // Y Axis (Paper numbers 1..N)
	    const stabYAxis = gStab.append("g")
	        .call(d3.axisLeft(yStab).tickFormat(i => i + 1));
	    stabYAxis.selectAll("text")
	        .attr("fill", "#888")
	        .style("font-size", "10px");
	    stabYAxis.selectAll("path, line")
	        .attr("stroke", "#444");
	
	    // Violin (density) helper functions
	    const kernelEpanechnikov = (bandwidth) => (v) => {
	        const x = v / bandwidth;
	        return Math.abs(x) <= 1 ? (0.75 * (1 - x * x)) / bandwidth : 0;
	    };
	    const kernelDensityEstimator = (kernel, xValues) => (sample) =>
	        xValues.map(x => [x, d3.mean(sample, s => kernel(x - s)) || 0]);
	
	    const violinX = d3.range(1, xDomainMax + 0.5, 0.5);
	    const kde = kernelDensityEstimator(kernelEpanechnikov(1.2), violinX);
	    boxData.forEach(d => {
	        const sample = rankDistributions.get(d.id) || [];
	        d.density = sample.length ? kde(sample) : violinX.map(x => [x, 0]);
	    });
	    const maxDensity = d3.max(boxData, d => d3.max(d.density, v => v[1])) || 1;
	    const violinScale = d3.scaleLinear()
	        .domain([0, maxDensity])
	        .range([0, yStab.bandwidth() / 2]);
	    const violinArea = d3.area()
	        .curve(d3.curveCatmullRom.alpha(0.6))
	        .x(d => xStab(d[0]))
	        .y0(d => -violinScale(d[1]))
	        .y1(d => violinScale(d[1]));

	    // Render Violin + Box Plots
	    const groups = gStab.selectAll(".stab-row")
	        .data(boxData)
	        .join("g")
	        .attr("class", "stab-row")
	        .attr("transform", (d, i) => `translate(0, ${yStab(i) + yStab.bandwidth()/2})`);
	
	    groups.append("path")
	        .attr("d", d => violinArea(d.density))
	        .attr("fill", READ_NODE_COLOR)
	        .attr("opacity", 0.18)
	        .attr("stroke", READ_NODE_COLOR)
	        .attr("stroke-opacity", 0.45)
	        .attr("stroke-width", 1);
	
	    // Box/whiskers (outline only; no fill)
	    const whiskerColor = "#94a3b8";
	    const boxStroke = "#e2e8f0";
	    const boxHeight = Math.max(12, yStab.bandwidth() * 0.62);
	    const capSize = Math.max(8, yStab.bandwidth() * 0.55);
	
	    // Whisker line + caps (min to max)
	    groups.append("line")
	        .attr("x1", d => xStab(d.min))
	        .attr("x2", d => xStab(d.max))
	        .attr("stroke", whiskerColor)
	        .attr("stroke-width", 1)
	        .attr("stroke-opacity", 0.9);
	    groups.append("line")
	        .attr("x1", d => xStab(d.min))
	        .attr("x2", d => xStab(d.min))
	        .attr("y1", -capSize / 2)
	        .attr("y2", capSize / 2)
	        .attr("stroke", whiskerColor)
	        .attr("stroke-width", 1)
	        .attr("stroke-opacity", 0.9);
	    groups.append("line")
	        .attr("x1", d => xStab(d.max))
	        .attr("x2", d => xStab(d.max))
	        .attr("y1", -capSize / 2)
	        .attr("y2", capSize / 2)
	        .attr("stroke", whiskerColor)
	        .attr("stroke-width", 1)
	        .attr("stroke-opacity", 0.9);
	
	    // IQR box (q1 to q3)
	    groups.append("rect")
	        .attr("x", d => Math.min(xStab(d.q1), xStab(d.q3)))
	        .attr("y", -boxHeight / 2)
	        .attr("width", d => Math.max(8, Math.abs(xStab(d.q3) - xStab(d.q1))))
	        .attr("height", boxHeight)
	        .attr("fill", "none")
	        .attr("stroke", boxStroke)
	        .attr("stroke-opacity", 0.9)
	        .attr("stroke-width", 1);
	
	    // Median line
	    groups.append("line")
	        .attr("x1", d => xStab(d.median))
	        .attr("x2", d => xStab(d.median))
	        .attr("y1", -boxHeight / 2)
	        .attr("y2", boxHeight / 2)
	        .attr("stroke", boxStroke)
	        .attr("stroke-opacity", 0.95)
	        .attr("stroke-width", 1);

	    // Tooltip for papers
	    groups.append("rect") // Invisible overlay for tooltip
	        .attr("x", 0)
	        .attr("y", -yStab.bandwidth()/2)
	        .attr("width", stabInnerWidth)
	        .attr("height", yStab.bandwidth())
	        .attr("fill", "transparent")
	        .style("cursor", "help")
	        .on("mouseover", (event, d) => {
	            const tooltip = d3.select(".heatmap-tooltip");
	            tooltip.transition().duration(200).style("opacity", 1);
	            tooltip.html(`
	                <div><b>${d.title}</b></div>
	                <div style="margin-top:4px;">Rank range: ${d.min} - ${d.max}</div>
	                <div>Typical (IQR): ${d.q1} - ${d.q3}</div>
	                <div>Median: ${d.median}</div>
	            `)
	            .style("left", (event.pageX + 10) + "px")
	            .style("top", (event.pageY - 28) + "px");
	        })
	        .on("mouseout", () => {
	             d3.select(".heatmap-tooltip").transition().duration(500).style("opacity", 0);
	        });

    updateAnalyticsSelection();
}
