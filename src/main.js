setupControls();
setupPanelToggle();
setupDragAndDrop();

Promise.all([
    d3.csv("data/cocitation_network.csv"),
    d3.csv("data/bibliographic_coupling_network.csv"),
    d3.csv("data/main_papers.csv"),
    d3.csv("data/references.csv"),
    d3.csv("data/citation.csv")
]).then(([cocitationData, bibliographicData, metaData, refData, citData]) => {

    const citationTimelines = new Map();
    citData.forEach(row => {
        const sourceId = row.source_paper_id ? row.source_paper_id.trim() : null;
        if (!sourceId) return;
        const dateStr = row.citing_paper_publication_date;
        if (!dateStr) return;
        const d = new Date(dateStr);
        if (!isNaN(d)) {
            if (!citationTimelines.has(sourceId)) citationTimelines.set(sourceId, []);
            citationTimelines.get(sourceId).push(d);
        }
    });

    metaData.forEach(row => {
        const cited = row.cited_by_count ? +row.cited_by_count : undefined;
        const parsedDate = row.publication_date ? Date.parse(row.publication_date) : undefined;
        const validDate = Number.isFinite(parsedDate) ? new Date(parsedDate) : undefined;
        const yr = validDate ? validDate.getFullYear() : undefined;
        const institution = row.first_institution ? row.first_institution.trim() : undefined;
        const venue = row.venue ? row.venue.trim() : undefined;
        const primaryTopic = row.primary_topic ? row.primary_topic.trim() : undefined;
        const domain = row.domain ? row.domain.trim() : undefined;
        const field = row.field ? row.field.trim() : undefined;
        const subfield = row.subfield ? row.subfield.trim() : undefined;
        const fwci = row.fwci ? +row.fwci : undefined;
        const isRead = row.read ? +row.read === 1 : false;
        const title = row.title ? row.title.trim() : "Untitled";
        
        // Survey detection logic
        const type = (row.type || "").toLowerCase();
        const titleLower = title.toLowerCase();
        const isSurvey = type.includes("review") || type.includes("survey") || titleLower.includes("survey") || titleLower.includes("review");

        paperMeta.set(row.id, {
            year: yr,
            cited,
            date: validDate,
            dateValue: validDate ? validDate.getTime() : undefined,
            institution,
            venue,
            primaryTopic,
            domain,
            field,
            subfield,
            fwci,
            isRead,
            isSurvey,
            title,
            citationDates: citationTimelines.get(row.id) || []
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
