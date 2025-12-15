function buildSankeyData({
    activePaperIds, // changed from readPaperIds
    mainMeta,
    foundationsByPaper,
    audienceByPaper
}) {
    // 1. Identify Top Categories (Field) for Foundations (Left) and Audience (Right)
    const foundationTotals = aggregateCategoryTotals(foundationsByPaper, activePaperIds);
    const audienceTotals = aggregateCategoryTotals(audienceByPaper, activePaperIds);

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

    // Middle Nodes: Active Papers (Read + Selected)
    activePaperIds.forEach(paperId => {
        const meta = mainMeta.get(paperId) || {};
        addNode({
            id: `P:${paperId}`,
            name: meta.title || paperId,
            type: "paper",
            paperId,
            primaryTopic: meta.primaryTopic,
            isRead: meta.isRead,
            isSurvey: meta.isSurvey // Add survey status
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

    const paperFoundationTotals = totalsForPapers(foundationsByPaper, activePaperIds);
    const paperAudienceTotals = totalsForPapers(audienceByPaper, activePaperIds);

    const linksAgg = new Map();
    const addLink = (sourceId, targetId, paperId, value) => {
        const key = `${sourceId}→${targetId}`;
        const prev = linksAgg.get(key);
        if (prev) prev.value += value;
        else linksAgg.set(key, { source: sourceId, target: targetId, value, paperId });
    };

    activePaperIds.forEach(paperId => {
        const fCounts = foundationsByPaper.get(paperId) || new Map();
        const aCounts = audienceByPaper.get(paperId) || new Map();
        
        // Foundation -> Paper
        fCounts.forEach((count, catRaw) => {
            const cat = topFoundationCats.has(catRaw) ? catRaw : "Other";
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
        this.highlightRead = true; // Default match UI
        this.highlightSurvey = false;
        
        this.setupResizeObserver();
    }
    
    setFilter(type, value) {
        if (type === 'read') this.highlightRead = value;
        if (type === 'survey') this.highlightSurvey = value;
        this.updateGraph();
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
        this.height = Math.max(0, rect.height - 40); // Subtract header height approx, ensure non-negative
        this.svg.attr("width", this.width).attr("height", this.height);
    }

    setData(refData, citData) {
        this.refData = refData;
        this.citData = citData;
        this.updateGraph();
    }

    updateGraph() {
        if (this.width < 50 || this.height < 50) return;
        this.svg.selectAll("*" ).remove();

        // 1. Get Active Papers (Read + Selected)
        const activePaperIds = new Set();
        paperMeta.forEach((meta, id) => {
            if (meta.isRead) activePaperIds.add(id);
        });
        // Add currently selected nodes
        selectedNodeIds.forEach(id => activePaperIds.add(id));

        if (activePaperIds.size === 0) {
            this.svg.append("text")
                .attr("x", this.width/2)
                .attr("y", this.height/2)
                .attr("text-anchor", "middle")
                .attr("fill", "#666")
                .text("No read or selected papers.");
            return;
        }

        // 2. Build Category Counts (Field)
        const foundationsByPaper = buildPaperCategoryCounts(this.refData, "source_paper_id", "paper_field");
        const audienceByPaper = buildPaperCategoryCounts(this.citData, "source_paper_id", "paper_field");

        // 3. Build Sankey Data
        const graphData = buildSankeyData({
            activePaperIds, // Pass the combined set
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
            .nodeAlign(d3.sankeyLeft) 
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
            audience: "#C4B5FD"    // violet-300
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
                 return "#fff";
            })
            .style("mix-blend-mode", "screen");

        link.append("title")
            .text(d => `${d.source.name} → ${d.target.name}
${d.value} connections`);

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
                // Paper coloring logic
                if (this.highlightRead && d.isRead) return READ_NODE_COLOR;
                if (this.highlightSurvey && d.isSurvey) return SURVEY_NODE_COLOR;
                return DEFAULT_NODE_COLOR;
            })
            .attr("opacity", 0.9)
            .style("cursor", d => d.type === "paper" ? "pointer" : "default")
            .on("click", (event, d) => {
                if (d.type === "paper") {
                    handleGlobalNodeClick(event, { id: d.paperId });
                }
            })
            .on("mouseenter", (event, d) => {
                if (d.type !== "paper" || selectedNodeIds.size > 0) return;
                
                // Highlight connected links
                link.classed("highlighted", l => l.paperId === d.paperId);
                // Highlight this node
                node.classed("highlighted", n => n.type === "paper" && n.paperId === d.paperId);
            })
            .on("mouseleave", () => {
                link.classed("highlighted", false);
                node.classed("highlighted", false);
                // We don't need to re-apply selection highlighting here because updateGraph rebuilds it, 
                // but since this is mouseleave, we might want to just restore state.
                // However, since we re-render on selection change, the 'dimmed' state is handled by updateGraph's logic?
                // Wait, updateSelection is separate. 
                // Let's call updateSelection to be safe if we are in a static state.
                this.updateHighlights(selectedNodeIds);
            });

        node.append("title")
            .text(d => `${d.name}
${d.value}`);

        // Labels
        g.append("g")
            .attr("font-size", "10px")
            .attr("fill", "#ddd")
            .style("pointer-events", "none")
            .selectAll("text")
            .data(graph.nodes.filter(d => d.type !== "paper")) // Exclude paper labels
            .join("text")
            .attr("x", d => d.x0 < this.width / 2 ? d.x1 + 6 : d.x0 - 6)
            .attr("y", d => (d.y1 + d.y0) / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", d => d.x0 < this.width / 2 ? "start" : "end")
            .text(d => d.name);
            
        this.nodesSelection = node;
        this.linksSelection = link;
        
        // Apply selection highlights
        this.updateHighlights(selectedNodeIds);
    }
    
    updateSelection(selectedSet) {
         // Re-render the graph to include/exclude nodes based on selection
         this.updateGraph();
    }

    updateHighlights(selectedSet) {
         if (!this.nodesSelection || !this.linksSelection) return;
         
         if (selectedSet.size === 0) {
             this.nodesSelection.classed("dimmed", false);
             this.linksSelection.classed("dimmed", false);
             return;
         }
         
         this.nodesSelection.classed("dimmed", d => {
             if (d.type === "paper") {
                 return !selectedSet.has(d.paperId);
             }
             return false;
         });
         
         this.linksSelection.classed("dimmed", d => {
             return !selectedSet.has(d.paperId);
         });
    }
}

const sankeyGraph = new SankeyVisualizer("#sankey-svg", sankeyPanel);
