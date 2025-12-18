const horizontalPadding = 80;
const axisNumberFormatter = d3.format(",");
const axisDateFormatter = d3.timeFormat("%Y-%m-%d");
const DEFAULT_NODE_COLOR = "#60A5FA";
const READ_NODE_COLOR = "#4ADE80";
const SURVEY_NODE_COLOR = "#D946EF";
const DEFAULT_NODE_RADIUS = 10;

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
    },
    fwci: {
        label: "FWCI",
        scaleType: "linear",
        valueAccessor: node => node.fwci ?? null,
        formatTick: d => d.toFixed(2)
    },
    domain: {
        label: "Domain",
        scaleType: "categorical",
        valueAccessor: node => node.domain || "Unknown",
        formatTick: d => d
    },
    field: {
        label: "Field",
        scaleType: "categorical",
        valueAccessor: node => node.field || "Unknown",
        formatTick: d => d
    },
    subfield: {
        label: "Subfield",
        scaleType: "categorical",
        valueAccessor: node => node.subfield || "Unknown",
        formatTick: d => d
    },
    centrality: {
        label: "Degree Centrality",
        scaleType: "linear",
        valueAccessor: node => node.centrality || 0,
        formatTick: d => d.toFixed(3)
    },
    betweenness: {
        label: "Betweenness Centrality",
        scaleType: "linear",
        valueAccessor: node => node.betweenness || 0,
        formatTick: d => d.toFixed(4)
    }
};
