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
}

function updateAnalyticsSelection() {
    // Only update heatmap selection visuals
    const container = d3.select(".heatmap-container");
    container.classed("has-selection", selectedNodeIds.size > 0);
    container.selectAll(".heatmap-cell")
        .classed("highlighted", d => selectedNodeIds.has(d.unreadId));
}

const graphs = [cocitationGraph, bibliographicGraph];

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
    });
}

setupPanelToggle();

function setupNetworkTypeToggle() {
    const cocitationCheckbox = document.getElementById('cocitation-checkbox');
    const bibliographicCheckbox = document.getElementById('bibliographic-checkbox');
    const appContainer = document.getElementById('app-container');

    if (!cocitationCheckbox || !bibliographicCheckbox || !appContainer) return;

    function updateLayout() {
        const cocitationChecked = cocitationCheckbox.checked;
        const bibliographicChecked = bibliographicCheckbox.checked;

        // Remove all network-related classes
        appContainer.classList.remove('both-networks', 'only-cocitation', 'only-bibliographic');

        if (cocitationChecked && bibliographicChecked) {
            appContainer.classList.add('both-networks');
        } else if (cocitationChecked) {
            appContainer.classList.add('only-cocitation');
        } else if (bibliographicChecked) {
            appContainer.classList.add('only-bibliographic');
        }

        // Prevent unchecking both
        if (!cocitationChecked && !bibliographicChecked) {
            cocitationCheckbox.checked = true;
            appContainer.classList.add('only-cocitation');
        }
    }

    cocitationCheckbox.addEventListener('change', updateLayout);
    bibliographicCheckbox.addEventListener('change', updateLayout);

    updateLayout();
}

setupNetworkTypeToggle();

function setupAnalyticsControls() {
    const buttons = document.querySelectorAll('.rank-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            buttons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const mode = e.target.dataset.mode;
            updateAnalytics(mode);
        });
    });
}

Promise.all([
    d3.csv("data/cocitation_network.csv"),
    d3.csv("data/bibliographic_coupling_network.csv"),
    d3.csv("data/main_papers.csv")
]).then(([cocitationData, bibliographicData, metaData]) => {

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
    panel.selectAll(".histogram-container").remove();

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

    // 5. Render Histogram
    // Calculate Read Neighbor Counts for Unread Papers
    const coverageCounts = new Map();
    let maxReadNeighbors = 0;

    for (const p of unreadPapers) {
        let readNeighbors = 0;
        if (adjacency.has(p.id)) {
            for (const neighborId of adjacency.get(p.id).keys()) {
                if (readPaperIds.has(neighborId)) {
                    readNeighbors++;
                }
            }
        }
        const currentCount = coverageCounts.get(readNeighbors) || 0;
        coverageCounts.set(readNeighbors, currentCount + 1);
        if (readNeighbors > maxReadNeighbors) maxReadNeighbors = readNeighbors;
    }

    const histData = [];
    for (let i = 0; i <= maxReadNeighbors; i++) {
        histData.push({
            bin: i,
            count: coverageCounts.get(i) || 0
        });
    }

    const histContainer = panel.append("div").attr("class", "histogram-container");
    const hNode = histContainer.node();
    const hWidth = hNode ? hNode.getBoundingClientRect().width : 300;
    const hHeight = 220;
    const hMargin = { top: 20, right: 20, bottom: 40, left: 40 };
    const hInnerWidth = hWidth - hMargin.left - hMargin.right;
    const hInnerHeight = hHeight - hMargin.top - hMargin.bottom;

    const histSvg = histContainer.append("svg")
        .attr("width", hWidth)
        .attr("height", hHeight);

    const hG = histSvg.append("g")
        .attr("transform", `translate(${hMargin.left},${hMargin.top})`);

    const xHist = d3.scaleBand()
        .domain(histData.map(d => d.bin))
        .range([0, hInnerWidth])
        .padding(0.2);

    const yHist = d3.scaleLinear()
        .domain([0, d3.max(histData, d => d.count) || 1])
        .range([hInnerHeight, 0]);

    hG.selectAll(".hist-bar")
        .data(histData)
        .join("rect")
        .attr("class", "hist-bar")
        .attr("x", d => xHist(d.bin))
        .attr("y", d => yHist(d.count))
        .attr("width", xHist.bandwidth())
        .attr("height", d => hInnerHeight - yHist(d.count));

    // Axes
    const xAxisG = hG.append("g")
        .attr("class", "hist-axis")
        .attr("transform", `translate(0,${hInnerHeight})`)
        .call(d3.axisBottom(xHist).tickValues(xHist.domain().filter((d, i) => !(i % 2)))); // Filter ticks if many

    const yAxisG = hG.append("g")
        .attr("class", "hist-axis")
        .call(d3.axisLeft(yHist).ticks(5));

    // Labels
    hG.append("text")
        .attr("class", "hist-label")
        .attr("x", hInnerWidth / 2)
        .attr("y", hInnerHeight + 35)
        .text("# Read Neighbors");

    hG.append("text")
        .attr("class", "hist-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -hInnerHeight / 2)
        .attr("y", -30)
        .text("# Unread Papers");

    updateAnalyticsSelection();
}