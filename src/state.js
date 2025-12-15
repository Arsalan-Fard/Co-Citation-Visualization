// DOM Elements
const cocitationPanel = document.getElementById('cocitation-panel');
const bibliographicPanel = document.getElementById('bibliographic-panel');
const sankeyPanel = document.getElementById('sankey-panel');

// Shared metadata and configuration
let paperMeta = new Map();
let xAxisMetric = "date";
let yAxisMetric = "citation";
let nodeSizeMetric = "degree";
let nodeColorMetric = "none";
let positionStability = 1;

// Global data storage
let globalCocitationData = [];
let globalBibliographicData = [];
let selectedNodeIds = new Set();
let currentAnalyticsMode = "both";
