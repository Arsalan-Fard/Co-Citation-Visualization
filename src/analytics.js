function updateAnalytics(mode = "both") {
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

    const readPapers = [];
    const unreadPapers = [];
    const readPaperIds = new Set();

    for (const [id, meta] of paperMeta.entries()) {
        if (meta.isRead) {
            readPapers.push({ id, title: meta.title });
            readPaperIds.add(id);
        } else {
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

    const panel = d3.select(".analytics-panel");
    panel.selectAll(".paper-list").remove();
    panel.selectAll(".heatmap-container").remove();
    panel.selectAll(".charts-grid").remove();
    panel.selectAll(".heatmap-legend").remove();
    panel.selectAll(".coverage-chart-container").remove();

    // --- Heatmap Visualization ---
    if (readPapers.length > 0 && top10.length > 0) {
        const heatmapContainer = panel.append("div")
            .attr("class", "heatmap-container")
            .style("display", "flex")
            .style("align-items", "center");

        // Static Side Label (Fixed)
        heatmapContainer.append("div")
            .text("Read Papers")
            .style("writing-mode", "vertical-rl")
            .style("transform", "rotate(180deg)")
            .style("font-size", "10px")
            .style("color", "#888")
            .style("width", "15px")
            .style("flex-shrink", "0")
            .style("text-align", "center")
            .style("margin-right", "4px");

        // Scrollable Area for SVG
        const scrollDiv = heatmapContainer.append("div")
            .attr("class", "heatmap-scroll-area")
            .style("flex-grow", "1")
            .style("overflow-y", "auto")
            .style("max-height", "250px") // Limit height to reduce visual footprint
            .style("height", "100%"); // Ensure it fills container height if defined in CSS

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
        // Estimate width: container width minus label width (approx 20px)
        const totalWidth = containerNode ? (containerNode.getBoundingClientRect().width - 25) : 280;
        const margin = { top: 25, right: 0, bottom: 0, left: 0 }; 
        
        const cellWidth = Math.floor((totalWidth - margin.left - margin.right) / 10);
        const cellHeight = cellWidth; // Revert to square cells
        const height = matrix.length * cellHeight + margin.top + margin.bottom;

        const svg = scrollDiv.append("svg")
            .attr("width", totalWidth)
            .attr("height", height);

        const g = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Top Label (Top 10 Recommendations)
        svg.append("text")
            .attr("x", totalWidth / 2)
            .attr("y", margin.top / 2 + 5)
            .style("text-anchor", "middle")
            .style("font-size", "10px")
            .style("fill", "#888")
            .text("Top 10 Recommendations");

        // Removed number labels (1-10) as requested

        const colorScale = d3.scaleSequential(d3.interpolateBlues)
            .domain([0, Math.log10((maxVal || 1) + 1)]); 

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
                .attr("class", d => `heatmap-cell row-read-${d.readId}`)
                .attr("x", (d, j) => j * cellWidth)
                .attr("y", i * cellHeight)
                .attr("width", cellWidth - 1)
                .attr("height", cellHeight - 1)
                .attr("fill", d => d.value === 0 ? "#ffffff" : colorScale(Math.log10(d.value + 1)))
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
        const legendWidth = totalWidth - margin.left - margin.right - 10;
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
                .attr("stop-color", d3.interpolateBlues(offset));
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
            .text(maxVal.toFixed(1) + " (log scale)");
    }



    // --- Coverage Gap Analysis (Horizontal Bar Chart) ---
    const coverageContainer = panel.append("div").attr("class", "coverage-chart-container");
    
    coverageContainer.append("div")
        .style("font-size", "14px")
        .style("font-weight", "600")
        .style("color", "#888")
        .style("text-transform", "uppercase")
        .style("letter-spacing", "1px")
        .style("margin-bottom", "8px")
        .style("padding-top", "12px")
        .style("text-align", "center")
        .text("Coverage Gap Analysis");

    const fieldStats = new Map();
    paperMeta.forEach(meta => {
        const f = meta.field || "Unknown";
        if (!fieldStats.has(f)) fieldStats.set(f, { name: f, total: 0, read: 0 });
        const stat = fieldStats.get(f);
        stat.total++;
        if (meta.isRead) stat.read++;
    });

    const coverageData = Array.from(fieldStats.values())
        .sort((a, b) => (a.read / a.total) - (b.read / b.total)); // Sort by least covered first

    const rowHeight = 35;
    const covHeight = coverageData.length * rowHeight + 30;
    const covWidth = 280;
    const covMargin = { top: 20, right: 40, bottom: 10, left: 90 }; // Left for labels
    
    const covSvg = coverageContainer.append("svg")
        .attr("width", covWidth)
        .attr("height", covHeight);

    const covG = covSvg.append("g")
        .attr("transform", `translate(${covMargin.left},${covMargin.top})`);

    const xCov = d3.scaleLinear()
        .domain([0, d3.max(coverageData, d => d.total) || 1])
        .range([0, covWidth - covMargin.left - covMargin.right]);

    const yCov = d3.scaleBand()
        .domain(coverageData.map(d => d.name))
        .range([0, coverageData.length * rowHeight])
        .padding(0.4);

    // Axis
    covG.append("g")
        .call(d3.axisLeft(yCov).tickSize(0))
        .selectAll("text")
        .style("fill", "#888")
        .style("font-size", "10px")
        .style("text-anchor", "end")
        .text(d => d.length > 15 ? d.substring(0, 13) + ".." : d)
        .append("title")
        .text(d => d);
        
    covG.selectAll(".domain, line").remove(); // Clean axis

    const barGroups = covG.selectAll(".cov-row")
        .data(coverageData)
        .join("g")
        .attr("class", "cov-row")
        .attr("transform", d => `translate(0, ${yCov(d.name)})`);

    // Total Bar (Background)
    barGroups.append("rect")
        .attr("height", yCov.bandwidth())
        .attr("width", d => xCov(d.total))
        .attr("fill", "#333")
        .attr("rx", 2);

    // Read Bar
    barGroups.append("rect")
        .attr("height", yCov.bandwidth())
        .attr("width", d => xCov(d.read))
        .attr("fill", "#4A90E2")
        .attr("rx", 2);

    // Projected Bar (Ghost) - Initialized to 0
    barGroups.append("rect")
        .attr("class", "projected-bar")
        .attr("height", yCov.bandwidth())
        .attr("x", d => xCov(d.read))
        .attr("width", 0)
        .attr("fill", "#4cd964") // Greenish for "Gain"
        .attr("opacity", 0.6)
        .attr("rx", 2);

    // Text Label (e.g. "5/20")
    barGroups.append("text")
        .attr("class", "cov-label")
        .attr("x", d => xCov(d.total) + 5)
        .attr("y", yCov.bandwidth() / 2 + 3)
        .text(d => `${d.read}/${d.total}`)
        .style("font-size", "9px")
        .style("fill", "#666");

    updateAnalyticsSelection();
}

function updateAnalyticsSelection() {
    const container = d3.select(".heatmap-container");
    container.classed("has-selection", selectedNodeIds.size > 0);
    
    // Clear all highlights first
    container.selectAll(".heatmap-cell").classed("highlighted", false);

    if (selectedNodeIds.size > 0) {
        container.selectAll(".heatmap-cell")
            .classed("highlighted", d => {
                // Check if this cell's unreadId (column) OR readId (row) is in the selection
                return selectedNodeIds.has(d.unreadId) || selectedNodeIds.has(d.readId);
            });
    }

    // --- Update Coverage Chart Projection ---
    // Recalculate basic stats to rebuild scale (lightweight enough)
    const fieldStats = new Map();
    let maxTotal = 0;
    paperMeta.forEach(meta => {
        const f = meta.field || "Unknown";
        if (!fieldStats.has(f)) fieldStats.set(f, { total: 0 });
        fieldStats.get(f).total++;
    });
    fieldStats.forEach(s => { if(s.total > maxTotal) maxTotal = s.total; });

    const covWidth = 280;
    const covMargin = { top: 20, right: 40, bottom: 10, left: 90 };
    const xCov = d3.scaleLinear()
        .domain([0, maxTotal || 1])
        .range([0, covWidth - covMargin.left - covMargin.right]);

    const fieldProjections = new Map();
    if (selectedNodeIds.size > 0) {
        selectedNodeIds.forEach(id => {
            const meta = paperMeta.get(id);
            if (meta && !meta.isRead) {
                const f = meta.field || "Unknown";
                fieldProjections.set(f, (fieldProjections.get(f) || 0) + 1);
            }
        });
    }

    d3.selectAll(".projected-bar")
        .transition().duration(300)
        .attr("width", function() {
            // Get the data bound to the parent group
            const d = d3.select(this.parentNode).datum(); 
            const projectedCount = fieldProjections.get(d.name) || 0;
            return xCov(projectedCount);
        });

    d3.selectAll(".cov-label")
        .text(function() {
            const d = d3.select(this.parentNode).datum();
            const projectedCount = fieldProjections.get(d.name) || 0;
            const base = `${d.read}/${d.total}`;
            return projectedCount > 0 ? `${base} (+${projectedCount})` : base;
        })
        .style("fill", function() {
            const d = d3.select(this.parentNode).datum();
            const projectedCount = fieldProjections.get(d.name) || 0;
            return projectedCount > 0 ? "#4cd964" : "#666";
        })
        .style("font-weight", function() {
            const d = d3.select(this.parentNode).datum();
            const projectedCount = fieldProjections.get(d.name) || 0;
            return projectedCount > 0 ? "bold" : "normal";
        });
}
