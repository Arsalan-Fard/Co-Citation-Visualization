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
	        .style("color", "#888")
	        .style("margin-bottom", "8px")
	        .style("padding-top", "12px")
	        .style("text-align", "center")
	        .text("Stability of Selected Papers (Bootstrap Ranks)");

	    const stabNode = stabContainer.node();
	    const measuredStabWidth = stabNode ? stabNode.getBoundingClientRect().width : 0;
	    const stabWidth = Math.max(280, measuredStabWidth || 0);
	    const stabHeight = Math.max(250, 100 + (targetPapers.length || 1) * 20);
	    const stabMargin = { top: 22, right: 18, bottom: 44, left: 44 };
	    const stabInnerWidth = stabWidth - stabMargin.left - stabMargin.right - 20;
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

function updateAnalyticsSelection() {
    // Only update heatmap selection visuals
    const container = d3.select(".heatmap-container");
    container.classed("has-selection", selectedNodeIds.size > 0);
    container.selectAll(".heatmap-cell")
        .classed("highlighted", d => selectedNodeIds.has(d.unreadId));
}
