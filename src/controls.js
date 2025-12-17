const graphs = [cocitationGraph, bibliographicGraph, sankeyGraph];

function handleGlobalNodeClick(event, d) {
    event.stopPropagation();
    const nodeId = d.id;
    if (selectedNodeIds.has(nodeId)) {
        selectedNodeIds.delete(nodeId);
    } else {
        selectedNodeIds.add(nodeId);
    }
    updateAllSelections();
}

function handleGlobalClear() {
    selectedNodeIds.clear();
    updateAllSelections();
}

function updateAllSelections() {
    graphs.forEach(g => g.updateSelection(selectedNodeIds));
    updateAnalyticsSelection();
    updateAnalytics(currentAnalyticsMode);
}

function updateAllGraphs() {
    graphs.forEach(g => {
        g.updateDimensions();
        g.updateGraph();
    });
}

function setAxisMetric(axis, value) {
    if (!AXIS_METRICS[value]) return;
    if (axis === "x") {
        xAxisMetric = value;
    } else if (axis === "y") {
        yAxisMetric = value;
    }
}

function setupControls() {
    const xSelect = document.getElementById('x-axis-select');
    const ySelect = document.getElementById('y-axis-select');
    if (xSelect) {
        xSelect.value = xAxisMetric;
        xSelect.addEventListener('change', (event) => {
            setAxisMetric("x", event.target.value);
            updateAllGraphs();
        });
    }
    if (ySelect) {
        ySelect.value = yAxisMetric;
        ySelect.addEventListener('change', (event) => {
            setAxisMetric("y", event.target.value);
            updateAllGraphs();
        });
    }
    const nodeSizeSelect = document.getElementById('node-size-select');
    if (nodeSizeSelect) {
        nodeSizeSelect.value = nodeSizeMetric;
        nodeSizeSelect.addEventListener('change', (event) => {
            const value = event.target.value;
            if (!NODE_SIZE_OPTIONS.has(value)) return;
            nodeSizeMetric = value;
            updateAllGraphs();
        });
    }
    
    const cocitationSlider = document.getElementById('cocitation-strength-slider');
    const cocitationValue = document.getElementById('cocitation-threshold-value');
    if (cocitationSlider && cocitationValue) {
        cocitationSlider.addEventListener('input', (e) => {
            const val = +e.target.value;
            cocitationValue.textContent = val + "%";
            cocitationGraph.setEdgeThreshold(val);
        });
    }

    const bibliographicSlider = document.getElementById('bibliographic-strength-slider');
    const bibliographicValue = document.getElementById('bibliographic-threshold-value');
    if (bibliographicSlider && bibliographicValue) {
        bibliographicSlider.addEventListener('input', (e) => {
            const val = +e.target.value;
            bibliographicValue.textContent = val + "%";
            bibliographicGraph.setEdgeThreshold(val);
        });
    }

    const stabilitySlider = document.getElementById('stability-slider');
    const stabilityValue = document.getElementById('stability-value');
    if (stabilitySlider && stabilityValue) {
        stabilitySlider.value = positionStability;
        stabilityValue.textContent = positionStability.toFixed(2);
        stabilitySlider.addEventListener('input', (event) => {
            positionStability = parseFloat(event.target.value);
            stabilityValue.textContent = positionStability.toFixed(2);
            updateAllGraphs();
        });
    }

    const filterRead = document.getElementById('filter-read');
    const filterSurvey = document.getElementById('filter-survey');

    if (filterRead) {
        filterRead.addEventListener('change', (e) => {
            const checked = e.target.checked;
            cocitationGraph.setFilter('read', checked);
            bibliographicGraph.setFilter('read', checked);
            sankeyGraph.setFilter('read', checked);
        });
    }

    if (filterSurvey) {
        filterSurvey.addEventListener('change', (e) => {
            const checked = e.target.checked;
            cocitationGraph.setFilter('survey', checked);
            bibliographicGraph.setFilter('survey', checked);
            sankeyGraph.setFilter('survey', checked);
        });
    }

    const filterCitation = document.getElementById('filter-citation');
    if (filterCitation) {
        filterCitation.addEventListener('change', (e) => {
            const checked = e.target.checked;
            cocitationGraph.setFilter('citation', checked);
            bibliographicGraph.setFilter('citation', checked);
        });
    }
}

function setupPanelToggle() {
    const leftBtn = document.getElementById('toggle-left-panel-btn');
    const rightBtn = document.getElementById('toggle-right-panel-btn');
    const sidePanel = document.querySelector('.side-panel');
    const analyticsPanel = document.querySelector('.analytics-panel');
    const appContainer = document.getElementById('app-container');

    if (leftBtn && sidePanel) {
        leftBtn.addEventListener('click', () => {
            const isHidden = sidePanel.classList.toggle('hidden');
            leftBtn.classList.toggle('collapsed', isHidden);
            appContainer.classList.toggle('left-hidden', isHidden);
            if (window.updateAppLayout) window.updateAppLayout();
        });
    }

    if (rightBtn && analyticsPanel) {
        rightBtn.addEventListener('click', () => {
            const isHidden = analyticsPanel.classList.toggle('hidden');
            rightBtn.classList.toggle('collapsed', isHidden);
            appContainer.classList.toggle('right-hidden', isHidden);
            if (window.updateAppLayout) window.updateAppLayout();
        });
    }
}

function setupDragAndDrop() {
    const draggables = document.querySelectorAll('.draggable-item');
    const dropZones = document.querySelectorAll('.drop-zone');
    const sourceContainer = document.querySelector('.draggable-source');
    
    const panelMap = {
        'cocitation': 'cocitation-panel',
        'bibliographic': 'bibliographic-panel',
        'sankey': 'sankey-panel'
    };

    let draggedItem = null;

    draggables.forEach(draggable => {
        draggable.addEventListener('dragstart', () => {
            draggedItem = draggable;
            draggable.classList.add('dragging');
        });

        draggable.addEventListener('dragend', () => {
            draggable.classList.remove('dragging');
            draggedItem = null;
        });
    });

    dropZones.forEach(zone => {
        zone.addEventListener('dragover', e => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', e => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            
            if (!draggedItem) return;

            const existingItem = zone.querySelector('.draggable-item');
            if (existingItem) {
                sourceContainer.appendChild(existingItem);
            }

            zone.appendChild(draggedItem);
            updateLayoutFromDrop();
        });
    });

    // Also allow dropping back to source
    sourceContainer.addEventListener('dragover', e => {
        e.preventDefault();
    });

    sourceContainer.addEventListener('drop', e => {
        e.preventDefault();
        if (draggedItem) {
            sourceContainer.appendChild(draggedItem);
            updateLayoutFromDrop();
        }
    });

    window.updateAppLayout = updateLayoutFromDrop;

    function updateLayoutFromDrop() {
        const zone1Item = document.querySelector('.drop-zone[data-zone="1"] .draggable-item');
        const zone2Item = document.querySelector('.drop-zone[data-zone="2"] .draggable-item');
        
        const panel1Id = zone1Item ? panelMap[zone1Item.dataset.type] : null;
        const panel2Id = zone2Item ? panelMap[zone2Item.dataset.type] : null;

        const appContainer = document.getElementById('app-container');
        const panels = ['cocitation-panel', 'bibliographic-panel', 'sankey-panel'];
        
        panels.forEach(id => {
            const el = document.getElementById(id);
            if(el) {
                el.classList.add('hidden');
                el.style.gridColumn = 'auto';
            }
        });

        const leftHidden = appContainer.classList.contains('left-hidden');
        const rightHidden = appContainer.classList.contains('right-hidden');
        
        let gridTemplate = (leftHidden ? "0px " : "320px ");
        
        if (panel1Id) {
            const p1 = document.getElementById(panel1Id);
            p1.classList.remove('hidden');
            p1.style.gridColumn = "2";
            gridTemplate += "1fr ";
        } else {
             gridTemplate += "0fr ";
        }

        if (panel2Id) {
             const p2 = document.getElementById(panel2Id);
             p2.classList.remove('hidden');
             p2.style.gridColumn = "3";
             gridTemplate += "1fr ";
        } else {
             gridTemplate += "0fr ";
        }

        gridTemplate += (rightHidden ? "0px" : "360px");

        // Remove order properties as we are using explicit grid columns now
        if (panel1Id) document.getElementById(panel1Id).style.order = "";
        if (panel2Id) document.getElementById(panel2Id).style.order = "";
        
        appContainer.style.gridTemplateColumns = gridTemplate;
        
         setTimeout(() => {
            updateAllGraphs();
        }, 450);
    }

    const cocitationItem = sourceContainer.querySelector('[data-type="cocitation"]');
    const zone1 = document.querySelector('.drop-zone[data-zone="1"]');

    if (cocitationItem && zone1) zone1.appendChild(cocitationItem);

    updateLayoutFromDrop();
}

function setupAnalyticsControls() {
    const buttons = document.querySelectorAll('.rank-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            buttons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const mode = e.target.dataset.mode;
            currentAnalyticsMode = mode;
            updateAnalytics(mode);
        });
    });
}

let contextMenuTargetId = null;

function showContextMenu(event, nodeId) {
    event.preventDefault();
    contextMenuTargetId = nodeId;
    const menu = document.getElementById('context-menu');
    if (!menu) {
        console.error("Context menu element not found!");
        return;
    }

    console.log(`Showing menu for ${nodeId} at ${event.pageX}, ${event.pageY}`);

    menu.style.position = 'fixed';
    menu.style.left = `${event.clientX}px`; 
    menu.style.top = `${event.clientY}px`; 
    
    menu.classList.remove('hidden');
    menu.style.display = 'block';
    menu.style.zIndex = '99999';
}


function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) {
        menu.classList.add('hidden');
        menu.style.display = 'none';
    }
    contextMenuTargetId = null;
}

function deleteNode(nodeId) {
    if (!nodeId) return;
    
    paperMeta.delete(nodeId);
    
    selectedNodeIds.delete(nodeId);
    
    updateAllGraphs();
    updateAnalytics(currentAnalyticsMode);
}

function setupContextMenu() {
    document.addEventListener('click', () => {
        hideContextMenu();
    });

    const deleteBtn = document.getElementById('menu-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (contextMenuTargetId) {
                deleteNode(contextMenuTargetId);
                hideContextMenu();
            }
        });
    }
}

setupContextMenu();
