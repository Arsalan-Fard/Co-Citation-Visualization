const horizontalPadding = 80;
const axisNumberFormatter = d3.format(",");
const axisDateFormatter = d3.timeFormat("%Y-%m-%d");
const DEFAULT_NODE_COLOR = "#8EA2FF";
const READ_NODE_COLOR = "#4ADE80";
const SURVEY_NODE_COLOR = "#D946EF";
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
