import pandas as pd
from itertools import combinations
import os

REFERENCES_FILE = "Phase1/references.csv"
OUTPUT_FILE = "Phase1/bibliographic_coupling_network.csv"

def main():
    if not os.path.exists(REFERENCES_FILE):
        return

    try:
        df = pd.read_csv(REFERENCES_FILE)
    except Exception as e:
        return

    if 'source_paper_id' not in df.columns or 'referenced_paper_id' not in df.columns:
        return

    grouped = df.groupby('referenced_paper_id')['source_paper_id'].apply(list)

    pair_counts = {}

    for ref_id, source_list in grouped.items():
        unique_sources = sorted(list(set(source_list)))

        if len(unique_sources) < 2:
            continue

        for p1, p2 in combinations(unique_sources, 2):
            pair = (p1, p2)
            pair_counts[pair] = pair_counts.get(pair, 0) + 1

    rows = []
    for (p1, p2), count in pair_counts.items():
        rows.append({
            'paper1': p1,
            'paper2': p2,
            'coupling_strength': count
        })

    if rows:
        out_df = pd.DataFrame(rows)
        out_df = out_df.sort_values(by='coupling_strength', ascending=False)

        out_df.to_csv(OUTPUT_FILE, index=False)

if __name__ == "__main__":
    main()
