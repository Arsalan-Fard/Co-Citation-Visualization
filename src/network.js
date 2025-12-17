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
        this.edgeThreshold = 0; // 0 to 100
        this.highlightRead = true; // Default matches HTML checked state
        this.highlightSurvey = false;
        this.highlightCitation = false;
        this.axisScaleX = 1;
        this.axisScaleY = 1;
        
        this.setupSVG();
        this.setupResizeObserver();
    }
    
    setEdgeThreshold(value) {
        this.edgeThreshold = +value;
        this.updateGraph();
    }

    setFilter(type, value) {
        if (type === 'read') this.highlightRead = value;
        if (type === 'survey') this.highlightSurvey = value;
        if (type === 'citation') this.highlightCitation = value;
        this.applyFilterStyles();
    }

    applyFilterStyles() {
        if (!this.nodes || !this.currentNodeSelection) return;

        if (this.highlightCitation) {
            this.updateGradients(this.nodes);
        } else {
            this.svg.select("defs").selectAll(".burst-gradient").remove();
        }

        if (this.fillForNode) {
            this.currentNodeSelection.attr("fill", d => this.fillForNode(d));
        }
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

    updateGradients(nodes) {
        const defs = this.svg.select("defs");
        const nodesWithData = nodes.filter(d => d.citationDates && d.citationDates.length > 0);
        
        const showRead = this.highlightRead;
        const showSurvey = this.highlightSurvey;
        
        // Define scales: 0 (White) -> 1 (Color)
        const scaleBlue = d3.scaleLinear().domain([0, 1]).range(["#ffffff", "#3B82F6"]);
        const scaleGreen = d3.scaleLinear().domain([0, 1]).range(["#ffffff", "#4ADE80"]);
        const scalePurple = d3.scaleLinear().domain([0, 1]).range(["#ffffff", "#D946EF"]);

        defs.selectAll(".burst-gradient")
            .data(nodesWithData, d => d.id)
            .join(
                enter => enter.append("radialGradient")
                    .attr("id", d => `grad-${d.id.replace(/[^a-zA-Z0-9]/g, '')}`)
                    .attr("class", "burst-gradient")
                    .attr("cx", "50%")
                    .attr("cy", "50%")
                    .attr("r", "50%"),
                update => update,
                exit => exit.remove()
            )
            .each(function(d) {
                const sel = d3.select(this);
                sel.selectAll("stop").remove();
                
                // Select Scale
                let colorScale = scaleBlue;
                if (showRead && d.isRead) colorScale = scaleGreen;
                else if (showSurvey && d.isSurvey) colorScale = scalePurple;

                const start = d.date ? d.date.getTime() : (d.citationDates[0].getTime());
                const end = new Date().getTime();
                const span = end - start;
                
                if (span <= 0) {
                     sel.append("stop").attr("offset", "100%").attr("stop-color", "#ccc");
                     return;
                }
                
                const bins = 8;
                const counts = new Array(bins).fill(0);
                
                d.citationDates.forEach(date => {
                    const t = date.getTime();
                    if (t < start) return;
                    const pos = (t - start) / span;
                    const idx = Math.min(bins - 1, Math.floor(pos * bins));
                    counts[idx]++;
                });
                
                const maxC = Math.max(...counts) || 1;
                
                for(let i=0; i<bins; i++) {
                    const color = colorScale(counts[i] / maxC);
                    sel.append("stop")
                        .attr("offset", `${(i / bins) * 100}%`)
                        .attr("stop-color", color);
                    sel.append("stop")
                        .attr("offset", `${((i+1) / bins) * 100}%`)
                        .attr("stop-color", color);
                }
            });
    }

    updateSelection(selectedSet) {
        const links = this.graphGroup.selectAll(".link");
        const nodes = this.graphGroup.selectAll(".node");

        links.classed("highlighted", false).classed("dimmed", false);
        nodes.classed("selected", false).classed("dimmed", false);

        if (selectedSet.size === 0) {
            // Even without selection, dim orphans
            nodes.classed("dimmed", d => d.degree === 0);
            return;
        }

        // Identify neighbors of selected nodes
        const neighborSet = new Set();
        if (this.links) {
            this.links.forEach(l => {
                if (selectedSet.has(l.sourceId)) neighborSet.add(l.targetId);
                if (selectedSet.has(l.targetId)) neighborSet.add(l.sourceId);
            });
        }

        // Highlight connected links, dim others
        links.classed("highlighted", l => selectedSet.has(l.sourceId) || selectedSet.has(l.targetId))
             .classed("dimmed", l => !selectedSet.has(l.sourceId) && !selectedSet.has(l.targetId));

        // Select specific nodes, dim others (unless neighbor)
        // Also dim orphans (degree 0) even if selected? No, if selected it should be visible.
        // But an orphan can't have neighbors.
        nodes.classed("selected", d => selectedSet.has(d.id))
             .classed("dimmed", d => {
                 if (selectedSet.has(d.id)) return false; // Selected is never dimmed
                 if (neighborSet.has(d.id)) return false; // Neighbor is never dimmed
                 // Otherwise dimmed (either disconnected from selection, OR orphan)
                 return true; 
             });
             
        // Bring selected to front
        nodes.filter(d => selectedSet.has(d.id)).raise();
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
        // Removed rotateGroup, append graphGroup directly to panZoomGroup
        this.graphGroup = this.panZoomGroup.append("g").attr("class", "graph-layer");
        
        // Persistent Layers
        this.gridLayer = this.graphGroup.append("g").attr("class", "grid-layer");
        this.linksLayer = this.graphGroup.append("g").attr("class", "links-layer");
        this.nodesLayer = this.graphGroup.append("g").attr("class", "nodes-layer");

        this.zoom = d3.zoom()
            .filter((event) => !event.ctrlKey)
            .scaleExtent([0.3, 5])
            .on("zoom", (event) => {
                this.panZoomGroup.attr("transform", event.transform);
            });

        this.svg.call(this.zoom);

        // Axis Scaling Logic
        let scaling = false;
        let startX = 0;
        let startY = 0;
        let startScaleX = 1;
        let startScaleY = 1;
        const self = this;

        this.svg.on("pointerdown.scale", (event) => {
            if (event.ctrlKey && event.button === 0) {
                scaling = true;
                startX = event.clientX;
                startY = event.clientY;
                startScaleX = self.axisScaleX;
                startScaleY = self.axisScaleY;
                self.svg.style("cursor", "crosshair");
                event.preventDefault();
                event.stopImmediatePropagation(); // Prevent Zoom
            }
        });

        const winNs = "pointermove.scale." + (this.svg.attr("id") || Math.random());

        d3.select(window).on(winNs, (event) => {
            if (!scaling) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            const k = 0.005;
            
            self.axisScaleX = Math.max(0.1, startScaleX * (1 + dx * k));
            self.axisScaleY = Math.max(0.1, startScaleY * (1 - dy * k));
            
            // Basic throttling via RAF is handled by the browser event loop mostly, 
            // but updateGraph might be heavy. 
            self.updateGraph(); 
        });

        d3.select(window).on(winNs.replace("move", "up"), () => {
            if (scaling) {
                scaling = false;
                self.svg.style("cursor", null);
            }
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
        this.resetZoom();
    }
    
    resetZoom() {
        if (this.zoom) {
            this.svg.call(this.zoom.transform, d3.zoomIdentity);
        }
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

        // Preserve previous positions to prevent re-layout explosion
        const oldPositions = new Map();
        if (this.nodes) {
            this.nodes.forEach(n => {
                oldPositions.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
            });
        }

        const nodes = Array.from(allNodeIds).map(id => {
            const meta = paperMeta.get(id) || {};
            const oldPos = oldPositions.get(id);
            return {
                id,
                x: oldPos ? oldPos.x : undefined,
                y: oldPos ? oldPos.y : undefined,
                vx: oldPos ? oldPos.vx : undefined,
                vy: oldPos ? oldPos.vy : undefined,
                year: meta.year,
                cited: meta.cited,
                dateValue: meta.dateValue,
                date: meta.date,
                institution: meta.institution,
                venue: meta.venue,
                primaryTopic: meta.primaryTopic,
                domain: meta.domain,
                field: meta.field,
                subfield: meta.subfield,
                fwci: meta.fwci,
                isRead: meta.isRead,
                isSurvey: meta.isSurvey,
                citationDates: meta.citationDates
            };
        }); // Removed filtering

        if (nodes.length === 0) {
            this.nodes = [];
            this.links = [];
            return;
        }

        const nodesById = new Map(nodes.map(node => [node.id, node]));

        const filteredLinks = this.rawData.filter(d =>
            allNodeIds.has(d.paper1) && allNodeIds.has(d.paper2)
        );
        
        let potentialLinks = filteredLinks.map(d => ({
            source: d.paper1,
            target: d.paper2,
            sourceId: d.paper1,
            targetId: d.paper2,
            strength: +d[this.strengthKey]
        })).filter(l => nodesById.has(l.sourceId) && nodesById.has(l.targetId));

        // Threshold Logic
        const fullStrengthExtent = potentialLinks.length ? d3.extent(potentialLinks, d => d.strength) : [0, 1];
        const minS = fullStrengthExtent[0];
        const maxS = fullStrengthExtent[1];
        
        // If slider is 100, we want only max strength (or empty if logic dictates >= max)
        // If slider is 0, we want >= min (all)
        const cutoff = minS + (this.edgeThreshold / 100) * (maxS - minS);
        
        // Keep links >= cutoff
        // Special case: if cutoff == maxS and we want to show the max edges, >= is fine.
        // If we want to hide ALL at 100 unless they equal max, that's also fine.
        const links = potentialLinks.filter(l => l.strength >= cutoff);

        // --- DEBUG: Strength Distribution ---
        if (links.length > 0) {
            const strengths = links.map(d => d.strength);
            const min = Math.min(...strengths);
            const max = Math.max(...strengths);
            const avg = strengths.reduce((a, b) => a + b, 0) / strengths.length;

            console.groupCollapsed(`Strength Distribution for ${this.svg.attr("id")} (${links.length} links)`);
            console.log(`Range: [${min.toFixed(4)}, ${max.toFixed(4)}]`);
            console.log(`Average: ${avg.toFixed(4)}`);

            // Simple 10-bin histogram
            const bins = 10;
            const range = max - min;
            const binSize = range / bins || 1;
            const histogram = new Array(bins).fill(0);
            strengths.forEach(s => {
                const idx = Math.min(bins - 1, Math.floor((s - min) / binSize));
                histogram[idx]++;
            });

            console.log("Distribution (10 bins from min to max):");
            const maxCount = Math.max(...histogram);
            histogram.forEach((count, i) => {
                const binStart = (min + i * binSize).toFixed(3);
                const bar = "█".repeat(Math.ceil((count / maxCount) * 20));
                console.log(`${binStart.padEnd(7)} | ${bar} (${count})`);
            });
            console.groupEnd();
        }
        // ------------------------------------

        if (this.highlightCitation) {
            this.updateGradients(nodes);
        } else {
            this.svg.select("defs").selectAll(".burst-gradient").remove();
        }

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
            node.centrality = node.degree; // Alias for axis
        });

        // --- Betweenness Centrality Calculation (Brandes) ---
        // Only run if nodes < 2000 to prevent browser freeze (simple heuristic)
        if (nodes.length < 2000) {
            const adj = new Map();
            nodes.forEach(n => adj.set(n.id, []));
            links.forEach(l => {
                // Ensure IDs exist in map (links filtered by node existence already, but safe check)
                if(adj.has(l.sourceId)) adj.get(l.sourceId).push(l.targetId);
                if(adj.has(l.targetId)) adj.get(l.targetId).push(l.sourceId);
            });

            const CB = new Map();
            nodes.forEach(n => CB.set(n.id, 0));

            nodes.forEach(sNode => {
                const s = sNode.id;
                const S = [];
                const P = new Map();
                const sigma = new Map();
                const d = new Map();
                
                // Init
                nodes.forEach(v => {
                    P.set(v.id, []);
                    sigma.set(v.id, 0);
                    d.set(v.id, -1);
                });

                sigma.set(s, 1);
                d.set(s, 0);
                const Q = [s];

                while (Q.length > 0) {
                    const v = Q.shift();
                    S.push(v);
                    const neighbors = adj.get(v) || [];
                    for (const w of neighbors) {
                        if (d.get(w) < 0) {
                            Q.push(w);
                            d.set(w, d.get(v) + 1);
                        }
                        if (d.get(w) === d.get(v) + 1) {
                            sigma.set(w, sigma.get(w) + sigma.get(v));
                            P.get(w).push(v);
                        }
                    }
                }

                const delta = new Map();
                nodes.forEach(v => delta.set(v.id, 0));

                while (S.length > 0) {
                    const w = S.pop();
                    for (const v of P.get(w)) {
                        delta.set(v, delta.get(v) + (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w)));
                    }
                    if (w !== s) {
                        CB.set(w, CB.get(w) + delta.get(w));
                    }
                }
            });

            nodes.forEach(n => {
                n.betweenness = (CB.get(n.id) || 0) / 2;
            });
        } else {
             // Fallback for large graphs
             nodes.forEach(n => n.betweenness = 0);
        }

        // Use full extent for width scale stability (legacy usage removed)
        // const widthScale = d3.scaleLinear().domain(fullStrengthExtent).range([0.1, 0.6]); 

        const centerX = this.width / 2;
        const centerY = this.height / 2;

        const strengths = links.map(d => d.strength);
        const minStrength = Math.min(...strengths) || 1;
        const maxStrength = Math.max(...strengths) || 1;
        const minLog = Math.log(minStrength);
        const maxLog = Math.log(maxStrength);

        // Color Scale: Light Grey (weak) -> Vibrant Blue/Purple (strong)
        // d3.interpolateCool goes from Cyan to Magenta - usually visible on both dark/light
        const edgeColorScale = d3.scaleSequential(d3.interpolateBlues)
            .domain([0, 1]); // Normalized log strength

        const getLinkStyle = (strength) => {
             if (maxLog === minLog) return { width: 1, color: "#999" };
             const logVal = Math.log(strength);
             const norm = (logVal - minLog) / (maxLog - minLog);
             return {
                 width: 0.1 + (norm * 1.0), // Range 0.5px to 1.5px
                 color: edgeColorScale(norm)
             };
        };

        const baseW = Math.max(10, this.width - 2 * horizontalPadding);
        const scaledW = baseW * this.axisScaleX;
        const horizontalRange = [centerX - scaledW / 2, centerX + scaledW / 2];

        const baseH = Math.max(10, this.height - 120);
        const scaledH = baseH * this.axisScaleY;
        const verticalRange = [centerY + scaledH / 2, centerY - scaledH / 2];

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
            if (!Number.isFinite(node.x)) node.x = node.targetX;
            if (!Number.isFinite(node.y)) node.y = node.targetY;
            if (!Number.isFinite(node.vx)) node.vx = 0;
            if (!Number.isFinite(node.vy)) node.vy = 0;
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
            if (this.highlightCitation && node.citationDates && node.citationDates.length > 0) {
                return `url(#grad-${node.id.replace(/[^a-zA-Z0-9]/g, '')})`;
            }
            if (this.highlightRead && node.isRead) return READ_NODE_COLOR;
            if (this.highlightSurvey && node.isSurvey) return SURVEY_NODE_COLOR;
            if (!colorScale || nodeColorMetric === "none") return DEFAULT_NODE_COLOR;
            const value = getNodeColorValue(node, nodeColorMetric);
            if (!value) return DEFAULT_NODE_COLOR;
            return colorScale(value);
        };

        this.fillForNode = fillForNode;

        const gridLayer = this.graphGroup.append("g").attr("class", "grid-layer");

        const yRange = yScale.range();
        const yMin = Math.min(...yRange);
        const yMax = Math.max(...yRange);
        const xRange = xScale.range();
        const xMin = Math.min(...xRange);
        const xMax = Math.max(...xRange);
        // centerX, centerY already defined above

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

        // Apply rotation to all x-axis labels to prevent overlap
        xLabelGroup.attr("transform", d => `rotate(-45, ${xScale(d)}, ${yMax + 35})`)
                   .style("text-anchor", "end"); // Align text to end for better readability when rotated

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
            .style("stroke-width", d => getLinkStyle(d.strength).width)
            .style("stroke", d => getLinkStyle(d.strength).color) // Apply dynamic color
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
            })
            .on("contextmenu", (event, d) => {
                showContextMenu(event, d.id);
            })
            .on("mouseenter", (event, d) => {
                // Highlight connected links
                link.classed("hover-connected", l => l.source.id === d.id || l.target.id === d.id)
                    .style("stroke", l => {
                        if (l.source.id === d.id || l.target.id === d.id) return "#d0d0d0ff";
                        return getLinkStyle(l.strength).color;
                    })
                    .style("stroke-width", l => {
                        if (l.source.id === d.id || l.target.id === d.id) return 1.0;
                        return getLinkStyle(l.strength).width;
                    })
                    .style("stroke-opacity", l => {
                        if (l.source.id === d.id || l.target.id === d.id) return 1;
                        return null; // Revert to CSS default (or previous inline)
                    });
            })
            .on("mouseleave", (event, d) => {
                link.classed("hover-connected", false)
                    .style("stroke", l => getLinkStyle(l.strength).color)
                    .style("stroke-width", l => getLinkStyle(l.strength).width)
                    .style("stroke-opacity", null);
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

        // Store selections for ticked
        this.currentLinkSelection = link;
        this.currentNodeSelection = node;

        if (!this.simulation) {
            this.simulation = d3.forceSimulation(nodes)
                .force("link", d3.forceLink(links).id(d => d.id).distance(d => {
                    if (maxLog === minLog) return 200; 
                    const logVal = Math.log(d.strength);
                    const norm = (logVal - minLog) / (maxLog - minLog);
                    // Map 0..1 to 400..50 (Stronger = Closer)
                    return 400 - (norm * (400 - 50));
                }))
                .force("charge", d3.forceManyBody())
                .force("collision", d3.forceCollide())
                .force("x", d3.forceX(d => d.targetX))
                .force("y", d3.forceY(d => d.targetY))
                .force("center", d3.forceCenter(centerX, centerY));
        }

        // Always update forces and restart
        this.simulation.nodes(nodes);
        this.simulation.force("link").links(links).distance(d => {
            if (maxLog === minLog) return 200;
            const logVal = Math.log(d.strength);
            const norm = (logVal - minLog) / (maxLog - minLog);
            return 400 - (norm * (400 - 50));
        });
        this.simulation.force("center", d3.forceCenter(centerX, centerY));
        
        const sim = this.simulation;
        sim.force("link").strength(1.6 * forceWeight);
        sim.force("charge").strength(-50 * forceWeight);
        sim.force("collision").radius(d => radiusForNode(d) + 4).strength(0.9 * forceWeight);
        sim.force("x").x(d => d.targetX).strength(0.6 * axisWeight);
        sim.force("y").y(d => d.targetY).strength(0.6 * axisWeight);
        sim.force("center").strength(0.5 * forceWeight);
        
        // Update tick handler to use current selections
        sim.on("tick", () => {
            if (axisWeight >= 0.98) {
                 this.currentNodeSelection.attr("cx", d => d.x += (d.targetX - d.x) * 0.3)
                              .attr("cy", d => d.y += (d.targetY - d.y) * 0.3);
            } else {
                 this.currentNodeSelection.attr("cx", d => d.x).attr("cy", d => d.y);
            }
            
            const linkLerp = 0.18; // Ease edges so they don't outrun node movement
            this.currentLinkSelection.attr("d", d => {
                if (!Number.isFinite(d.rsx)) {
                    d.rsx = d.source.x; d.rsy = d.source.y;
                    d.rtx = d.target.x; d.rty = d.target.y;
                }
                d.rsx += (d.source.x - d.rsx) * linkLerp;
                d.rsy += (d.source.y - d.rsy) * linkLerp;
                d.rtx += (d.target.x - d.rtx) * linkLerp;
                d.rty += (d.target.y - d.rty) * linkLerp;

                const dx = d.rtx - d.rsx, dy = d.rty - d.rsy;
                const dr = Math.sqrt(dx * dx + dy * dy);
                return `M${d.rsx},${d.rsy}A${dr},${dr} 0 0,1 ${d.rtx},${d.rty}`;
            });
        });

        sim.alpha(0.3).restart();

        // this.svg.call(this.zoom.transform, d3.zoomIdentity); // Removed unconditional zoom reset
        
        if (this.svg.attr("id") === "graph-svg") {
             document.getElementById('node-count').textContent = nodes.length.toLocaleString();
             // Define strengthExtent alias for legacy code below if needed, or update usage
             const strengthExtent = fullStrengthExtent;
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
