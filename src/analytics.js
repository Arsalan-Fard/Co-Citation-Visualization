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
    panel.selectAll(".radial-chart-container").remove();

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



    // --- Radial Treemap (Sunburst) ---
    const radialContainer = panel.append("div").attr("class", "radial-chart-container");
    
    radialContainer.append("div")
        .style("font-size", "14px")
        .style("font-weight", "600")
        .style("color", "#888")
        .style("text-transform", "uppercase")
        .style("letter-spacing", "1px")
        .style("margin-bottom", "8px")
        .style("padding-top", "12px")
        .style("text-align", "center")
        .text("Paper Hierarchy");

    const rootData = { name: "All", children: [] };
    const domains = new Map();

    paperMeta.forEach((meta, id) => {
        const domain = meta.domain || "Unknown";
        const field = meta.field || "Unknown";
        const subfield = meta.subfield || "Unknown";
        
        if (!domains.has(domain)) domains.set(domain, new Map());
        const fields = domains.get(domain);
        
        if (!fields.has(field)) fields.set(field, new Map());
        const subfields = fields.get(field);
        
        if (!subfields.has(subfield)) subfields.set(subfield, []);
        subfields.get(subfield).push(id);
    });

    domains.forEach((fields, domainName) => {
        const domainNode = { name: domainName, children: [] };
        fields.forEach((subfields, fieldName) => {
            const fieldNode = { name: fieldName, children: [] };
            subfields.forEach((paperIds, subfieldName) => {
                const subfieldNode = { name: subfieldName, value: paperIds.length };
                fieldNode.children.push(subfieldNode);
            });
            domainNode.children.push(fieldNode);
        });
        rootData.children.push(domainNode);
    });

    const rWidth = 280;
    const rHeight = 280;
    const radius = rWidth / 2;
    const holeRadius = 25; 

    const color = d3.scaleOrdinal(d3.schemeCategory10);
    const format = d3.format(",d");

    const radialSvg = radialContainer.append("svg")
        .attr("width", rWidth)
        .attr("height", rHeight)
        .style("margin", "0 auto")
        .style("display", "block")
        .append("g")
        .attr("transform", `translate(${rWidth / 2},${rHeight / 2})`);

    const partition = d3.partition(); // Normalized [0,1]

    const root = d3.hierarchy(rootData)
        .sum(d => d.value)
        .sort((a, b) => b.value - a.value);

    partition(root);

    // Scales for zooming
    const x = d3.scaleLinear().range([0, 2 * Math.PI]);
    // Set y domain start to root.y1 so the first ring starts at holeRadius
    const y = d3.scaleSqrt().domain([root.y1, 1]).range([holeRadius, radius]);

    const arc = d3.arc()
        .startAngle(d => Math.max(0, Math.min(2 * Math.PI, x(d.x0))))
        .endAngle(d => Math.max(0, Math.min(2 * Math.PI, x(d.x1))))
        .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
        .padRadius(radius * 1.5)
        .innerRadius(d => Math.max(0, y(d.y0)))
        .outerRadius(d => Math.max(0, y(d.y1) - 1));

    // Render paths
    radialSvg.selectAll("path")
        .data(root.descendants().filter(d => d.depth)) // Filter out root
        .join("path")
        .attr("d", arc)
        .style("fill", d => {
             let domain = d;
             while (domain.depth > 1) domain = domain.parent;
             const baseColor = color(domain.data.name);
             
             // Mix with white based on depth to make it "brighter" (more pastel/whitish)
             // Depth 1 (Domain): 0% white (pure base color)
             // Depth 2 (Field): 30% white
             // Depth 3 (Subfield): 60% white
             const whiteFactor = (d.depth - 1) * 0.3;
             return d3.interpolateRgb(baseColor, "#ffffff")(Math.min(whiteFactor, 0.8));
        })
        .style("cursor", "pointer")
        .style("opacity", 1)
        .on("click", clicked)
        .append("title")
        .text(d => `${d.ancestors().map(d => d.data.name).reverse().join(" -> ")}\n${format(d.value)} papers`);

    let focus = root;

    // Center Clickable Area (to zoom out)
    const centerGroup = radialSvg.append("g")
        .style("cursor", "pointer")
        .on("click", (event) => {
             if (focus !== root && focus.parent) {
                 clicked(event, focus.parent);
             }
        });

    centerGroup.append("circle")
        .attr("r", holeRadius)
        .style("fill", "transparent");

    const centerText = centerGroup.append("text")
        .attr("pointer-events", "none")
        .attr("text-anchor", "middle")
        .attr("dy", "0.3em")
        .style("user-select", "none")
        .style("font-size", "10px")
        .style("font-weight", "bold")
        .style("fill", "#555")
        .text("All"); 

    function clicked(event, p) {
        focus = p;
        radialSvg.transition().duration(750).tween("scale", () => {
            const xd = d3.interpolate(x.domain(), [p.x0, p.x1]);
            const targetY0 = p === root ? root.y1 : p.y0;
            const yd = d3.interpolate(y.domain(), [targetY0, 1]);
            const yr = d3.interpolate(y.range(), [holeRadius, radius]); 
            return t => { x.domain(xd(t)); y.domain(yd(t)).range(yr(t)); };
        })
        .selectAll("path")
        .attrTween("d", d => () => arc(d));
        
        centerText.text(p.data.name.length > 12 ? p.data.name.substring(0, 10) + ".." : p.data.name);
    }

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

}
