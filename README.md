# Interactive Co-citation & Bibliographic Coupling Visualizations (Exploratory Search)

<img width="1910" height="906" alt="0" src="https://github.com/user-attachments/assets/1ab09ee1-f453-43fa-9c39-141828956973" />

This project is a browser-based visualization tool to explore a collection of scientific papers as a **network**, instead of a flat list.

It helps you:
- see how papers are related,
- find clusters (topics),
- spot “bridge” papers between topics,
- and **prioritize what to read next**.

It supports two main relationship types:
- **Co-citation**: two papers are linked if other papers cite them together (how the community groups them later).
- **Bibliographic coupling**: two papers are linked if they share references (how authors built on similar foundations at publication time).

It also includes a **Sankey view** for citation flows and side panels for recommendations and topic hierarchy.

---

## Features

### 1) Network views (co-citation / bibliographic coupling)
- Shows papers as nodes and relationships as links.
- Link thickness/color represent relationship strength.
- Works as:
  - a **scatterplot** when nodes are fixed by selected axes,
  - or a **force-directed graph** when layout is driven by link forces.

### 2) Scatterplot axes + hybrid layout (“Stability” slider)
- Pick X and Y axes from paper attributes (date, citations, FWCI, field, etc.).
- **Stability = 1.0** → nodes stay on their axis positions (scatterplot mode).
- **Stability = 0.0** → nodes move freely based on network forces (network mode).
- Values between 0 and 1 let you blend both, without losing context.

### 3) Sankey diagram (citation flow)
Shows how selected papers connect to:
- fields they **cite** (foundations),
- and fields that **cite them** (audience/impact).

### 4) Recommendation heatmap
Ranks unread papers by how strongly they connect to the papers you already read.

### 5) Paper hierarchy (radial treemap)
Shows coverage by:
**domain → field → subfield**.
Clicking a segment selects all papers in that category.

---

## Dataset

- Main dataset: **59 papers** collected for a master’s project topic (public participatory design).
- Data gathered using **OpenAlex API** from a list of DOIs.
- Derived graphs:
  - co-citation edges (weighted),
  - bibliographic coupling edges (weighted).
- A manual label marks whether a paper was **read**.

---

<img width="1892" height="886" alt="6" src="https://github.com/user-attachments/assets/5279d097-c2bb-4fa6-befa-8c0a82e758de" />


## How to run

This is a front-end (browser) app built with **vanilla HTML/CSS/JavaScript** and **D3.js**.

### Quick start
1. Clone this repo
2. Install Python dependencies:
   ```bash
   pip install pandas requests
   ```
3. Set your OpenAlex email in a local file (not committed):
   - Copy `data/local_config.example.py` to `data/local_config.py`
   - Set `OPENALEX_EMAIL` in `data/local_config.py`
4. Prepare a DOI text file (one DOI per line), for example `data/dois_hci.txt`
5. Generate all CSVs needed by the visualization with one command:
   ```bash
   python data/run_csv_pipeline.py --doi-file data/dois_hci.txt
   ```
6. Start a local server in the project folder, for example:
   ```bash
   python -m http.server 8000
   ```
7. Open `http://localhost:8000`

The pipeline command produces/overwrites:
- `data/main_papers.csv`
- `data/references.csv`
- `data/citation.csv`
- `data/cocitation_network.csv`
- `data/bibliographic_coupling_network.csv`

## Controls (what you can do in the UI)

- Choose up to **two** main visualizations at the same time.
- **Edge strength threshold** sliders remove weak links.
- **Stability** slider blends scatterplot vs force layout.
- Node coloring options:
  - **Read** papers highlight,
  - **Survey/review** papers highlight,
  - **Burst** shows citation timing pattern inside nodes (center = older, outer ring = newer).

Selection:
- Click one or more nodes to select.
- Non-selected nodes dim to keep focus.
- Selection is linked across:
  - network views,
  - Sankey,
  - recommendation heatmap,
  - and hierarchy treemap.

Navigation:
- Ctrl + drag to zoom (useful in dense areas).
- Buttons can collapse side panels to enlarge the main view.

