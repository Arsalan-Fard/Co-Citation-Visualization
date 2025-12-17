function buildSankeyData({
    activePaperIds,
    mainMeta,
    foundationsByPaper,
    audienceByPaper
}) {
    const foundationTotals = aggregateCategoryTotals(foundationsByPaper, activePaperIds);
    const audienceTotals = aggregateCategoryTotals(audienceByPaper, activePaperIds);

    const maxCategories = 10;
    const topFoundationCats = topKeysByValue(foundationTotals, maxCategories, ["Unknown"]);
    const topAudienceCats = topKeysByValue(audienceTotals, maxCategories, ["Unknown"]);
    
    topFoundationCats.add("Other");
    topAudienceCats.add("Other");

    const nodes = [];
    const nodeIndex = new Map();
    const addNode = (node) => {
        if (nodeIndex.has(node.id)) return;
        nodeIndex.set(node.id, nodes.length);
        nodes.push(node);
    };

    Array.from(topFoundationCats).forEach(cat => {
        addNode({
            id: `F:${cat}`,
            name: cat,
            type: "foundation"
        });
    });

    activePaperIds.forEach(paperId => {
        const meta = mainMeta.get(paperId) || {};
        addNode({
            id: `P:${paperId}`,
            name: meta.title || paperId,
            type: "paper",
            paperId,
            primaryTopic: meta.primaryTopic,
            isRead: meta.isRead,
            isSurvey: meta.isSurvey
        });
    });

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
        
        fCounts.forEach((count, catRaw) => {
            const cat = topFoundationCats.has(catRaw) ? catRaw : "Other";
            addLink(`F:${cat}`, `P:${paperId}`, paperId, count);
        });

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
        this.highlightRead = true;
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
        this.width = rect.width;
        this.height = Math.max(0, rect.height - 40);
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

        const activePaperIds = new Set();
        paperMeta.forEach((meta, id) => {
            if (meta.isRead) activePaperIds.add(id);
        });
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

        const foundationsByPaper = buildPaperCategoryCounts(this.refData, "source_paper_id", "paper_field");
        const audienceByPaper = buildPaperCategoryCounts(this.citData, "source_paper_id", "paper_field");

        const graphData = buildSankeyData({
            activePaperIds,
            mainMeta: paperMeta,
            foundationsByPaper,
            audienceByPaper
        });

        if (!graphData.nodes.length) return;

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

        const COLORS = {
            foundation: "#94A3B8",
            audience: "#C4B5FD"
        };

        const g = this.svg.append("g");

        const link = g.append("g")
            .attr("fill", "none")
            .attr("stroke-opacity", 0.15)
            .selectAll("path")
            .data(graph.links)
            .join("path")
            .attr("class", "sankey-link")
            .attr("d", d3.sankeyLinkHorizontal())
            .attr("stroke-width", d => Math.max(1, d.width))
            .attr("stroke", d => {
                 return "#fff";
            })
            .style("mix-blend-mode", "screen");

        link.append("title")
            .text(d => `${d.source.name} → ${d.target.name}
${d.value} connections`);

        const node = g.append("g")
            .selectAll("rect")
            .data(graph.nodes)
            .join("rect")
            .attr("class", "sankey-node")
            .attr("x", d => d.x0)
            .attr("y", d => d.y0)
            .attr("height", d => Math.max(1, d.y1 - d.y0))
            .attr("width", d => d.x1 - d.x0)
            .attr("fill", d => {
                if (d.type === "foundation") return COLORS.foundation;
                if (d.type === "audience") return COLORS.audience;
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
                if (d.type !== "paper") return;
                
                const hasSelection = selectedNodeIds.size > 0;
                const isSelected = selectedNodeIds.has(d.paperId);

                if (hasSelection && !isSelected) {
                    link.classed("hovered-candidate", l => l.paperId === d.paperId);
                    node.classed("hovered-candidate", n => n.type === "paper" && n.paperId === d.paperId);
                } else if (hasSelection && isSelected) {
                    link.classed("selected-hovered", l => l.paperId === d.paperId);
                    node.classed("selected-hovered", n => n.type === "paper" && n.paperId === d.paperId);
                } else if (!hasSelection) {
                    link.classed("highlighted", l => l.paperId === d.paperId);
                    node.classed("highlighted", n => n.type === "paper" && n.paperId === d.paperId);
                }
            })
            .on("mouseleave", () => {
                link.classed("highlighted", false)
                    .classed("hovered-candidate", false)
                    .classed("selected-hovered", false);
                node.classed("highlighted", false)
                    .classed("hovered-candidate", false)
                    .classed("selected-hovered", false);
                
                this.updateHighlights(selectedNodeIds);
            });

        node.append("title")
            .text(d => `${d.name}
${d.value}`);

        g.append("g")
            .attr("font-size", "10px")
            .attr("fill", "#ddd")
            .style("pointer-events", "none")
            .selectAll("text")
            .data(graph.nodes.filter(d => d.type !== "paper"))
            .join("text")
            .attr("x", d => d.x0 < this.width / 2 ? d.x1 + 6 : d.x0 - 6)
            .attr("y", d => (d.y1 + d.y0) / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", d => d.x0 < this.width / 2 ? "start" : "end")
            .text(d => d.name);
            
        this.nodesSelection = node;
        this.linksSelection = link;
        
        this.updateHighlights(selectedNodeIds);
    }
    
    updateSelection(selectedSet) {
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
