import pandas as pd
from itertools import combinations
import os

# =================CONFIGURATION =================
REFERENCES_FILE = "Phase1/references.csv"
OUTPUT_FILE = "Phase1/bibliographic_coupling_network.csv"
# ================================================

def main():
    print(f"Reading {REFERENCES_FILE}...")
    if not os.path.exists(REFERENCES_FILE):
        print(f"Error: {REFERENCES_FILE} not found.")
        return

    try:
        df = pd.read_csv(REFERENCES_FILE)
    except Exception as e:
        print(f"Error reading CSV: {e}")
        return

    # relevant columns: 'source_paper_id' (our main papers), 'referenced_paper_id' (the third party paper)
    if 'source_paper_id' not in df.columns or 'referenced_paper_id' not in df.columns:
        print("Error: Required columns missing from input CSV.")
        return

    # Group by referenced_paper_id to see which of our main papers cite the SAME paper
    # If referenced_paper_X is cited by [MainPaperA, MainPaperB], that's a coupling.
    grouped = df.groupby('referenced_paper_id')['source_paper_id'].apply(list)
    
    pair_counts = {}

    print("Processing bibliographic coupling...")
    for ref_id, source_list in grouped.items():
        # Remove duplicates (e.g. if source paper cites same ref twice - unlikely but safe)
        unique_sources = sorted(list(set(source_list)))
        
        # We need at least 2 source papers citing this same reference to form a link
        if len(unique_sources) < 2:
            continue
            
        # Generate all unique pairs of source papers that share this reference
        for p1, p2 in combinations(unique_sources, 2):
            pair = (p1, p2)
            pair_counts[pair] = pair_counts.get(pair, 0) + 1

    # Convert to DataFrame
    rows = []
    for (p1, p2), count in pair_counts.items():
        rows.append({
            'paper1': p1,
            'paper2': p2,
            'coupling_strength': count
        })
    
    if rows:
        out_df = pd.DataFrame(rows)
        # Sort by strength descending
        out_df = out_df.sort_values(by='coupling_strength', ascending=False)
        
        out_df.to_csv(OUTPUT_FILE, index=False)
        print(f"\nSuccess! Saved {len(out_df)} edges to {OUTPUT_FILE}")
        print("\nTop 5 coupled pairs:")
        print(out_df.head().to_string(index=False))
    else:
        print("\nNo bibliographic coupling found among the papers in references.csv.")

if __name__ == "__main__":
    main()
