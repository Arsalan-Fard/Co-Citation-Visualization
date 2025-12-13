import pandas as pd
import requests
import time
import sys
import os

# =================CONFIGURATION =================
EMAIL = "arsalan.masoudifard@ip-paris.fr" 
INPUT_FILE = "Phase1/main_papers.csv"
OUTPUT_FILE = "Phase1/references.csv"
# ================================================

def get_references(source_work_id):
    """Fetch all works cited by the source work (references)."""
    references = []
    per_page = 200
    cursor = '*'
    
    # Extract just the ID (e.g., W123) from the full URL if necessary
    # source_work_id might be "https://openalex.org/W123"
    w_id = source_work_id.split('/')[-1]
    
    # Filter 'cited_by' returns works that are cited by the given work ID.
    base_url = f"https://api.openalex.org/works?filter=cited_by:{w_id}"
    
    print(f"  Fetching references from: {base_url}")
    
    while True:
        url = f"{base_url}&per_page={per_page}&cursor={cursor}"
        
        try:
            response = requests.get(url, params={'mailto': EMAIL})
            if response.status_code == 200:
                data = response.json()
                results = data.get('results', [])
                references.extend(results)
                
                meta = data.get('meta', {})
                next_cursor = meta.get('next_cursor')
                
                # If no next cursor or fewer results than page limit, we are done
                if not next_cursor or len(results) < per_page:
                    break
                
                cursor = next_cursor
                time.sleep(0.1) # Be polite
            else:
                # If the filter isn't supported or fails, we might see 403 or 400.
                # Note: 'cited_by' is the correct filter for this direction.
                print(f"Error fetching references: {response.status_code}")
                break
        except Exception as e:
            print(f"Exception fetching references: {e}")
            break
            
    return references

def main():
    print(f"Reading {INPUT_FILE}...")
    if not os.path.exists(INPUT_FILE):
        print(f"Error: {INPUT_FILE} not found.")
        return

    try:
        df = pd.read_csv(INPUT_FILE)
    except Exception as e:
        print(f"Error reading CSV: {e}")
        return

    all_rows = []
    
    print(f"Processing {len(df)} source papers...")
    
    for idx, row in df.iterrows():
        source_id_url = row.get('id')
        if not source_id_url:
            continue
            
        print(f"\nProcessing [{idx+1}/{len(df)}]: {source_id_url}")
        
        # Fetch References (Outgoing citations)
        references = get_references(source_id_url)
        print(f"  Found {len(references)} references.")
        
        if not references:
            continue
            
        # Build Rows
        for ref_work in references:
            ref_id = ref_work.get('id')
            ref_title = ref_work.get('title')
            
            # Extract Topic/Field info from the REFERENCED paper
            r_primary_topic = ref_work.get('primary_topic') or {}
            r_topic_name = r_primary_topic.get('display_name', '')
            r_subfield_name = r_primary_topic.get('subfield', {}).get('display_name', '')
            r_field_name = r_primary_topic.get('field', {}).get('display_name', '')
            
            # Extract Authors from the REFERENCED paper (First Author Only)
            r_authorships = ref_work.get('authorships', [])
            
            if not r_authorships:
                # No authors listed
                new_row = {
                    'source_paper_id': source_id_url,
                    'author_id': '',
                    'author_name': '',
                    'institutions': '',
                    'paper_subfield': r_subfield_name,
                    'paper_field': r_field_name,
                    'paper_topic': r_topic_name,
                    'referenced_paper_id': ref_id,
                    'referenced_paper_name': ref_title,
                    'relationship': 'outgoing'
                }
                all_rows.append(new_row)
            else:
                # ONLY take the first author
                first_authorship = r_authorships[0]
                author = first_authorship.get('author', {})
                institutions = first_authorship.get('institutions', [])
                inst_names = "; ".join([inst.get('display_name', '') for inst in institutions])
                
                new_row = {
                    'source_paper_id': source_id_url,
                    'author_id': author.get('id'),
                    'author_name': author.get('display_name'),
                    'institutions': inst_names,
                    'paper_subfield': r_subfield_name,
                    'paper_field': r_field_name,
                    'paper_topic': r_topic_name,
                    'referenced_paper_id': ref_id,
                    'referenced_paper_name': ref_title,
                    'relationship': 'outgoing'
                }
                all_rows.append(new_row)
    
    # Save to CSV
    if all_rows:
        out_df = pd.DataFrame(all_rows)
        # Define column order
        cols = ['source_paper_id','author_id','author_name','institutions','paper_subfield',
                'paper_field','paper_topic','referenced_paper_id','referenced_paper_name','relationship']
        
        # Ensure we have all columns
        out_df = out_df[cols]
        
        out_df.to_csv(OUTPUT_FILE, index=False, encoding='utf-8')
        print(f"\nSuccess! Saved {len(out_df)} rows to {OUTPUT_FILE}")
    else:
        print("\nNo references found. Output file was not created.")

if __name__ == "__main__":
    main()
