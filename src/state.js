const cocitationPanel = document.getElementById('cocitation-panel');
const bibliographicPanel = document.getElementById('bibliographic-panel');
const sankeyPanel = document.getElementById('sankey-panel');

let paperMeta = new Map();
let xAxisMetric = "date";
let yAxisMetric = "citation";
let nodeSizeMetric = "degree";
let nodeColorMetric = "none";
let positionStability = 1;

let globalCocitationData = [];
let globalBibliographicData = [];
let selectedNodeIds = new Set();
let currentAnalyticsMode = "both";
