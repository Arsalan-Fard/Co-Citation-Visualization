import pandas as pd
import requests
import time
import sys
import os

# =================CONFIGURATION =================
EMAIL = "arsalan.masoudifard@ip-paris.fr" 
INPUT_FILE = "Phase1/main_papers.csv"
OUTPUT_FILE = "Phase1/citation.csv"
# ================================================

def get_work_details(work_id):
    """Fetch detailed info for a single work."""
    url = f"https://api.openalex.org/works/{work_id}"
    try:
        # Use simple ID or URL. OpenAlex handles both.
        response = requests.get(url, params={'mailto': EMAIL})
        if response.status_code == 200:
            return response.json()
        elif response.status_code == 404:
            print(f"Work not found: {work_id}")
        else:
            print(f"Error fetching work {work_id}: {response.status_code}")
    except Exception as e:
        print(f"Exception fetching work {work_id}: {e}")
    return None

def get_citations(api_url):
    """Fetch all works citing a given work, handling pagination."""
    citations = []
    per_page = 200
    cursor = '*'
    
    # Ensure URL is ready for params
    base_url = api_url
    if '?' not in base_url:
        base_url += '?'
    else:
        base_url += '&'
        
    print(f"  Fetching citations from: {api_url}")
    
    while True:
        url = f"{base_url}per_page={per_page}&cursor={cursor}"
        
        try:
            response = requests.get(url, params={'mailto': EMAIL})
            if response.status_code == 200:
                data = response.json()
                results = data.get('results', [])
                citations.extend(results)
                
                meta = data.get('meta', {})
                next_cursor = meta.get('next_cursor')
                
                # If no next cursor or fewer results than page limit, we are done
                if not next_cursor or len(results) < per_page:
                    break
                
                cursor = next_cursor
                time.sleep(0.1) # Be polite
            else:
                print(f"Error fetching citations: {response.status_code}")
                break
        except Exception as e:
            print(f"Exception fetching citations: {e}")
            break
            
    return citations

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
        
        # 1. Fetch Source Work Details (to get Authors and Topic Hierarchy)
        work = get_work_details(source_id_url)
        if not work:
            print("  Skipping (could not fetch details).")
            continue
            
        # Parse Topic Hierarchy
        primary_topic = work.get('primary_topic') or {}
        topic_name = primary_topic.get('display_name', '')
        subfield_name = primary_topic.get('subfield', {}).get('display_name', '')
        field_name = primary_topic.get('field', {}).get('display_name', '')
        
        # Parse Authors
        authors_data = []
        for authorship in work.get('authorships', []):
            author = authorship.get('author', {})
            institutions = authorship.get('institutions', [])
            # Join institution names with semicolon
            inst_names = "; ".join([inst.get('display_name', '') for inst in institutions])
            
            authors_data.append({
                'author_id': author.get('id'),
                'author_name': author.get('display_name'),
                'institutions': inst_names
            })
            
        if not authors_data:
            # Fallback if no authors listed (rare)
            authors_data.append({
                'author_id': '',
                'author_name': '',
                'institutions': ''
            })

        # 2. Fetch Incoming Citations
        cited_url = row.get('cited_by_api_url')
        
        # If the URL is missing or NaN, construct it manually
        if pd.isna(cited_url) or not cited_url:
            # Use the W ID if possible, or full URL
            # OpenAlex filter cites: accepts ID (e.g., W123)
            w_id = source_id_url.split('/')[-1]
            cited_url = f"https://api.openalex.org/works?filter=cites:{w_id}"
            
        citations = get_citations(cited_url)
        print(f"  Found {len(citations)} citations.")
        
        if not citations:
            continue
            
        # 3. Build Rows
        # Structure: One row per (Citing Paper, Citing Author) pair
        # The columns 'author_id', 'author_name', etc. refer to the CITING paper.
        for citation in citations:
            citing_id = citation.get('id')
            citing_name = citation.get('title')
            
            # Extract Topic/Field info from the CITING paper
            c_primary_topic = citation.get('primary_topic') or {}
            c_topic_name = c_primary_topic.get('display_name', '')
            c_subfield_name = c_primary_topic.get('subfield', {}).get('display_name', '')
            c_field_name = c_primary_topic.get('field', {}).get('display_name', '')
            
            # Extract Authors from the CITING paper
            c_authorships = citation.get('authorships', [])
            
            # Extract Cited By Count from the CITING paper
            cited_count = citation.get('cited_by_count', 0)

            if not c_authorships:
                # If no authors listed, add one row with empty author info
                new_row = {
                    'source_paper_id': source_id_url,
                    'author_id': '',
                    'author_name': '',
                    'institutions': '',
                    'paper_subfield': c_subfield_name,
                    'paper_field': c_field_name,
                    'paper_topic': c_topic_name,
                    'citing_paper_id': citing_id,
                    'citing_paper_name': citing_name,
                    'cited_by_count': cited_count,
                    'relationship': 'incoming'
                }
                all_rows.append(new_row)
            else:
                # ONLY take the first author
                first_authorship = c_authorships[0]
                author = first_authorship.get('author', {})
                institutions = first_authorship.get('institutions', [])
                inst_names = "; ".join([inst.get('display_name', '') for inst in institutions])
                
                new_row = {
                    'source_paper_id': source_id_url,
                    'author_id': author.get('id'),
                    'author_name': author.get('display_name'),
                    'institutions': inst_names,
                    'paper_subfield': c_subfield_name,
                    'paper_field': c_field_name,
                    'paper_topic': c_topic_name,
                    'citing_paper_id': citing_id,
                    'citing_paper_name': citing_name,
                    'cited_by_count': cited_count,
                    'relationship': 'incoming'
                }
                all_rows.append(new_row)
    
    # 4. Save to CSV
    if all_rows:
        out_df = pd.DataFrame(all_rows)
        # Ensure column order
        cols = ['source_paper_id','author_id','author_name','institutions','paper_subfield',
                'paper_field','paper_topic','citing_paper_id','citing_paper_name','cited_by_count','relationship']
        
        # Filter to only these columns
        out_df = out_df[cols]
        
        out_df.to_csv(OUTPUT_FILE, index=False, encoding='utf-8')
        print(f"\nSuccess! Saved {len(out_df)} rows to {OUTPUT_FILE}")
    else:
        print("\nNo relationships found. Output file was not created.")

if __name__ == "__main__":
    main()
