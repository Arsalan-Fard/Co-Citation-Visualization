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
    panel.selectAll(".stability-chart-container").remove();

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
        
        const cellSize = Math.floor((totalWidth - margin.left - margin.right) / 10);
        const height = matrix.length * cellSize + margin.top + margin.bottom;

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
                .attr("x", (d, j) => j * cellSize)
                .attr("y", i * cellSize)
                .attr("width", cellSize - 1)
                .attr("height", cellSize - 1)
                .attr("fill", d => d.value === 0 ? "#333" : colorScale(Math.log10(d.value + 1)))
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

    // --- Bayesian Topic Confidence (Violin Plot) ---
    const targetPapers = [];
    let chartTitle = "Relevance Confidence (Selected Papers)";

    if (selectedNodeIds.size > 0) {
        unreadPapers.forEach(p => {
            if (selectedNodeIds.has(p.id)) {
                targetPapers.push(p);
            }
        });
    }

    // 1. Train Topic Models (Beta Distributions)
    const topicStats = new Map(); // Map<topic, {alpha: num, beta: num}>
    
    // Priors: weak prior (alpha=1, beta=1) represents uniform uncertainty
    // If a topic is very common in the corpus but rarely read, Beta increases (low relevance).
    // If a topic is read often, Alpha increases (high relevance).
    
    // First, scan corpus to establish vocabulary and "background" frequency
    paperMeta.forEach(meta => {
        const topics = meta.allTopics || [];
        topics.forEach(t => {
            if (!topicStats.has(t)) topicStats.set(t, { alpha: 0.5, beta: 0.5, total: 0 }); // weak prior
            topicStats.get(t).total++;
        });
    });

    // Update with Read/Unread evidence
    paperMeta.forEach(meta => {
        const topics = meta.allTopics || [];
        topics.forEach(t => {
            const stat = topicStats.get(t);
            if (meta.isRead) {
                stat.alpha += 1.0; // Positive evidence
            } else {
                // For unread papers, it's weak negative evidence (we haven't chosen it YET)
                // But mostly it just adds to the denominator of "exposure" without "conversion"
                stat.beta += 0.1; 
            }
        });
    });

    // 2. Sample Distributions for Target Papers
    // We simulate "Probable Relevance Scores"
    const boxData = [];
    const nSamples = 50;

    // Helper: Box-Muller transform for Normal sample
    const randn_bm = () => {
        let u = 0, v = 0;
        while(u === 0) u = Math.random(); 
        while(v === 0) v = Math.random();
        return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    };

    targetPapers.forEach(p => {
        const meta = paperMeta.get(p.id);
        const topics = meta.allTopics || [];
        
        if (topics.length === 0) return; // Skip if no topic data

        const samples = [];
        
        for (let i = 0; i < nSamples; i++) {
            let sumProb = 0;
            
            topics.forEach(t => {
                const stat = topicStats.get(t) || { alpha: 1, beta: 1 };
                // Mean of Beta
                const mean = stat.alpha / (stat.alpha + stat.beta);
                // Variance of Beta
                const variance = (stat.alpha * stat.beta) / (Math.pow(stat.alpha + stat.beta, 2) * (stat.alpha + stat.beta + 1));
                const std = Math.sqrt(variance);

                // Sample from N(mean, std) as approximation
                // Clamp between 0 and 1
                let sample = mean + randn_bm() * std;
                sample = Math.max(0, Math.min(1, sample));
                
                sumProb += sample;
            });
            
            // Paper score is average of its topic scores
            samples.push(sumProb / topics.length);
        }

        samples.sort((a, b) => a - b);

        boxData.push({
            id: p.id,
            title: p.title,
            min: samples[0],
            q1: d3.quantile(samples, 0.25),
            median: d3.quantile(samples, 0.5),
            q3: d3.quantile(samples, 0.75),
            max: samples[samples.length - 1],
            samples: samples
        });
    });

    // --- Bayesian Topic Confidence (Violin Plot) ---
    // Always render container
    const stabContainer = panel.append("div").attr("class", "stability-chart-container");
    
    if (boxData.length > 0) {
        stabContainer.append("div")
            .style("font-size", "13px")
            .style("font-weight", "650")
            .style("color", "#888")
            .style("margin-bottom", "8px")
            .style("padding-top", "12px")
            .style("text-align", "center")
            .text(chartTitle);

        const stabNode = stabContainer.node();
        const measuredStabWidth = stabNode ? stabNode.getBoundingClientRect().width : 0;
        const stabWidth = Math.max(280, measuredStabWidth || 0);
        const stabHeight = Math.max(250, 100 + (boxData.length || 1) * 35); // slightly taller rows
        const stabMargin = { top: 22, right: 18, bottom: 44, left: 44 };
        const stabInnerWidth = stabWidth - stabMargin.left - stabMargin.right - 20;
        const stabInnerHeight = stabHeight - stabMargin.top - stabMargin.bottom;

        const stabSvg = stabContainer.append("svg")
            .attr("width", stabWidth)
            .attr("height", stabHeight);

        const gStab = stabSvg.append("g")
            .attr("transform", `translate(${stabMargin.left},${stabMargin.top})`);

        const yStab = d3.scaleBand()
            .domain(boxData.map((d, i) => i))
            .range([0, stabInnerHeight])
            .padding(0.2);

        // X Axis is now Relevance Probability (0 to 1)
        const xStab = d3.scaleLinear()
            .domain([0, 1])
            .range([0, stabInnerWidth]);

        const stabGrid = gStab.append("g")
            .attr("class", "grid-lines")
            .attr("transform", `translate(0,${stabInnerHeight})`)
            .call(d3.axisBottom(xStab).ticks(5).tickSize(-stabInnerHeight).tickFormat(""));
        stabGrid.selectAll("line")
            .attr("stroke", "#94a3b8")
            .attr("stroke-opacity", 0.14);
        stabGrid.selectAll("path").remove();

        // X Axis Label
        const stabXAxis = gStab.append("g")
            .attr("transform", `translate(0,${stabInnerHeight})`)
            .call(d3.axisBottom(xStab).ticks(5));
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
            .text("Predicted Relevance Probability");

        const stabYAxis = gStab.append("g")
            .call(d3.axisLeft(yStab).tickFormat(i => i + 1));
        stabYAxis.selectAll("text")
            .attr("fill", "#888")
            .style("font-size", "10px");
        stabYAxis.selectAll("path, line")
            .attr("stroke", "#444");
    
        // Violin Density Logic
        const kernelEpanechnikov = (bandwidth) => (v) => {
            const x = v / bandwidth;
            return Math.abs(x) <= 1 ? (0.75 * (1 - x * x)) / bandwidth : 0;
        };
        const kernelDensityEstimator = (kernel, xValues) => (sample) =>
            xValues.map(x => [x, d3.mean(sample, s => kernel(x - s)) || 0]);
    
        const violinX = d3.range(0, 1.05, 0.05); // Sample points 0.0 to 1.0
        const kde = kernelDensityEstimator(kernelEpanechnikov(0.1), violinX);
        
        boxData.forEach(d => {
            d.density = d.samples.length ? kde(d.samples) : violinX.map(x => [x, 0]);
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

        const groups = gStab.selectAll(".stab-row")
            .data(boxData)
            .join("g")
            .attr("class", "stab-row")
            .attr("transform", (d, i) => `translate(0, ${yStab(i) + yStab.bandwidth()/2})`);
    
        // Violin Shape
        groups.append("path")
            .attr("d", d => violinArea(d.density))
            .attr("fill", "#4a90e2")
            .attr("opacity", 0.3)
            .attr("stroke", "#4a90e2")
            .attr("stroke-opacity", 0.6)
            .attr("stroke-width", 1);
    
        const whiskerColor = "#94a3b8";
        const boxStroke = "#e2e8f0";
        const boxHeight = Math.max(8, yStab.bandwidth() * 0.4);
        const capSize = Math.max(6, yStab.bandwidth() * 0.3);
    
        // Whiskers
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
    
        // Box (IQR)
        groups.append("rect")
            .attr("x", d => Math.min(xStab(d.q1), xStab(d.q3)))
            .attr("y", -boxHeight / 2)
            .attr("width", d => Math.max(2, Math.abs(xStab(d.q3) - xStab(d.q1))))
            .attr("height", boxHeight)
            .attr("fill", "#2b2b2b") // Dark fill for contrast against blue violin
            .attr("stroke", boxStroke)
            .attr("stroke-opacity", 0.9)
            .attr("stroke-width", 1);
    
        // Median Line
        groups.append("line")
            .attr("x1", d => xStab(d.median))
            .attr("x2", d => xStab(d.median))
            .attr("y1", -boxHeight / 2)
            .attr("y2", boxHeight / 2)
            .attr("stroke", "#fff")
            .attr("stroke-opacity", 1)
            .attr("stroke-width", 2);

        // Tooltip interaction
        groups.append("rect") // Invisible overlay
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
                    <div style="margin-top:4px;">Relevance: ${(d.median * 100).toFixed(1)}%</div>
                    <div>Confidence: ${((1 - (d.q3 - d.q1)) * 100).toFixed(0)}%</div>
                `)
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => {
                 d3.select(".heatmap-tooltip").transition().duration(500).style("opacity", 0);
            });
    } else {
        // Empty state
        stabContainer.style("min-height", "250px")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border-top", "1px solid #333");
            
        stabContainer.append("div")
            .style("color", "#666")
            .style("font-size", "13px")
            .style("font-style", "italic")
            .text("Select unread papers to see Bayesian relevance confidence analysis");
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
