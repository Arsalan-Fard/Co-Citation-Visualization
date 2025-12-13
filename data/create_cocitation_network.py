import pandas as pd
from itertools import combinations
import os

# =================CONFIGURATION =================
CITATION_FILE = "Phase1/citation.csv"
OUTPUT_FILE = "Phase1/cocitation_network.csv"
# ================================================

def main():
    print(f"Reading {CITATION_FILE}...")
    if not os.path.exists(CITATION_FILE):
        print(f"Error: {CITATION_FILE} not found.")
        return

    try:
        df = pd.read_csv(CITATION_FILE)
    except Exception as e:
        print(f"Error reading CSV: {e}")
        return

    # relevant columns: 'source_paper_id' (our main papers), 'citing_paper_id' (the papers that cite them)
    if 'source_paper_id' not in df.columns or 'citing_paper_id' not in df.columns:
        print("Error: Required columns missing from input CSV.")
        return

    # Group by citing_paper_id to see which of our main papers are cited together
    grouped = df.groupby('citing_paper_id')['source_paper_id'].apply(list)
    
    pair_counts = {}

    print("Processing co-citations...")
    for citing_id, cited_list in grouped.items():
        # Remove duplicates just in case the same paper is listed multiple times for one citing paper
        unique_cited = sorted(list(set(cited_list)))
        
        # We need at least 2 papers to form a pair
        if len(unique_cited) < 2:
            continue
            
        # Generate all unique pairs
        for p1, p2 in combinations(unique_cited, 2):
            # p1 and p2 are already sorted because unique_cited is sorted
            pair = (p1, p2)
            pair_counts[pair] = pair_counts.get(pair, 0) + 1

    # Convert to DataFrame
    rows = []
    for (p1, p2), count in pair_counts.items():
        rows.append({
            'paper1': p1,
            'paper2': p2,
            'cocitation_strength': count
        })
    
    if rows:
        out_df = pd.DataFrame(rows)
        # Sort by strength descending for better visibility
        out_df = out_df.sort_values(by='cocitation_strength', ascending=False)
        
        out_df.to_csv(OUTPUT_FILE, index=False)
        print(f"\nSuccess! Saved {len(out_df)} edges to {OUTPUT_FILE}")
        print("\nTop 5 co-citations:")
        print(out_df.head().to_string(index=False))
    else:
        print("\nNo co-citations found among the papers in citation.csv.")

if __name__ == "__main__":
    main()
