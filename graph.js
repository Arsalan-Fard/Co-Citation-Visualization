const cocitationPanel = document.getElementById('cocitation-panel');
const bibliographicPanel = document.getElementById('bibliographic-panel');

// Shared metadata and configuration
let paperMeta = new Map();
let xAxisMetric = "date";
let yAxisMetric = "citation";
let nodeSizeMetric = "degree";
let nodeColorMetric = "none";
let positionStability = 1;

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

    highlightNode(nodeId) {
        this.graphGroup.selectAll(".link").classed("highlighted", false);
        this.graphGroup.selectAll(".node").classed("selected", false);

        this.graphGroup.selectAll(".link")
            .filter(l => l.sourceId === nodeId || l.targetId === nodeId)
            .classed("highlighted", true);

        this.graphGroup.selectAll(".node")
            .filter(d => d.id === nodeId)
            .classed("selected", true)
            .raise();
    }

    clearHighlight() {
        this.graphGroup.selectAll(".link").classed("highlighted", false);
        this.graphGroup.selectAll(".node").classed("selected", false);
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
    }
}

const cocitationGraph = new NetworkVisualizer("#graph-svg", cocitationPanel, "cocitation_strength");
const bibliographicGraph = new NetworkVisualizer("#bibliographic-svg", bibliographicPanel, "coupling_strength");

function handleGlobalNodeClick(event, d) {
    event.stopPropagation();
    const nodeId = d.id;
    graphs.forEach(g => g.highlightNode(nodeId));
}

function handleGlobalClear() {
    graphs.forEach(g => g.clearHighlight());
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

// Global resize listener removed; handled by ResizeObserver in visualizers

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
        
        // No explicit update needed; ResizeObserver will catch it
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
        
        // No explicit update needed; ResizeObserver will catch it
    }

    cocitationCheckbox.addEventListener('change', updateLayout);
    bibliographicCheckbox.addEventListener('change', updateLayout);

    // Initialize layout
    updateLayout();
}

setupNetworkTypeToggle();

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
        paperMeta.set(row.id, {
            year: yr,
            cited,
            date: validDate,
            dateValue: validDate ? validDate.getTime() : undefined,
            institution,
            venue,
            primaryTopic,
            isRead
        });
    });

    cocitationGraph.setData(cocitationData);
    bibliographicGraph.setData(bibliographicData);
    
    // Initial dimension update
    updateAllGraphs();

}).catch(error => {
    console.error("Error loading CSVs:", error);
    // Mock data handling if needed, or just log error
});

function createCharts() {
    const chart1 = d3.select("#chart1");
    // ... chart creation code remains same but ensure safe selection ...
    if (chart1.empty()) return;
    
    const c1Width = chart1.node().getBoundingClientRect().width;
    const c1Height = 200;
    const c1Margin = { top: 20, right: 20, bottom: 30, left: 40 };
    const c1InnerWidth = c1Width - c1Margin.left - c1Margin.right;
    const c1InnerHeight = c1Height - c1Margin.top - c1Margin.bottom;

    const barData = Array.from({ length: 10 }, (_, i) => ({
        category: `C${i + 1}`,
        value: Math.floor(Math.random() * 100) + 20
    }));

    const c1g = chart1.append("g")
        .attr("transform", `translate(${c1Margin.left},${c1Margin.top})`);

    const xScale1 = d3.scaleBand()
        .domain(barData.map(d => d.category))
        .range([0, c1InnerWidth])
        .padding(0.2);

    const yScale1 = d3.scaleLinear()
        .domain([0, d3.max(barData, d => d.value)])
        .range([c1InnerHeight, 0]);

    c1g.selectAll("rect")
        .data(barData)
        .join("rect")
        .attr("x", d => xScale1(d.category))
        .attr("y", d => yScale1(d.value))
        .attr("width", xScale1.bandwidth())
        .attr("height", d => c1InnerHeight - yScale1(d.value))
        .attr("fill", "#667eea")
        .attr("rx", 3);

    c1g.append("g")
        .attr("transform", `translate(0,${c1InnerHeight})`)
        .call(d3.axisBottom(xScale1))
        .style("font-size", "10px")
        .style("color", "#666");

    c1g.append("g")
        .call(d3.axisLeft(yScale1).ticks(5))
        .style("font-size", "10px")
        .style("color", "#666");

    const chart2 = d3.select("#chart2");
    if (chart2.empty()) return;
    
    const c2Width = chart2.node().getBoundingClientRect().width;
    const lineData = Array.from({ length: 20 }, (_, i) => ({
        x: i,
        y: 30 + Math.sin(i / 3) * 20 + Math.random() * 10
    }));

    const c2g = chart2.append("g")
        .attr("transform", `translate(${c1Margin.left},${c1Margin.top})`);

    const xScale2 = d3.scaleLinear()
        .domain([0, 19])
        .range([0, c2Width - c1Margin.left - c1Margin.right]);

    const yScale2 = d3.scaleLinear()
        .domain([0, d3.max(lineData, d => d.y)])
        .range([c1InnerHeight, 0]);

    const line = d3.line()
        .x(d => xScale2(d.x))
        .y(d => yScale2(d.y))
        .curve(d3.curveMonotoneX);

    c2g.append("path")
        .datum(lineData)
        .attr("fill", "none")
        .attr("stroke", "#667eea")
        .attr("stroke-width", 2)
        .attr("d", line);

    c2g.selectAll("circle")
        .data(lineData)
        .join("circle")
        .attr("cx", d => xScale2(d.x))
        .attr("cy", d => yScale2(d.y))
        .attr("r", 3)
        .attr("fill", "#764ba2")
        .attr("stroke", "#1a1a1a")
        .attr("stroke-width", 2);

    c2g.append("g")
        .attr("transform", `translate(0,${c1InnerHeight})`)
        .call(d3.axisBottom(xScale2).ticks(10))
        .style("font-size", "10px")
        .style("color", "#666");

    c2g.append("g")
        .call(d3.axisLeft(yScale2).ticks(5))
        .style("font-size", "10px")
        .style("color", "#666");
}

createCharts();