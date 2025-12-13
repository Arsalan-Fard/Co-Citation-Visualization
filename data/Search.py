import requests
import pandas as pd
import re
import time

# =================CONFIGURATION =================
# OpenAlex asks for an email to put you in the "polite pool" for faster response times.
EMAIL = "arsalan.masoudifard@ip-paris.fr" 
INPUT_FILE = "dois.txt"
OUTPUT_FILE = "main_papers.csv"
# ================================================

def extract_dois_from_text(file_path):
    """
    Reads a text file and uses regex to find all DOI-like strings.
    """
    dois = []
    # Regex pattern for DOIs (standard format starting with 10.)
    doi_pattern = r'\b(10\.\d{4,9}/[-._;()/:A-Z0-9]+)\b'
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            text = f.read()
            # Find all matches, ignoring case
            matches = re.findall(doi_pattern, text, re.IGNORECASE)
            # Clean up potential trailing punctuation often caught in bibliography parsing
            cleaned_matches = [m.rstrip('.') for m in matches]
            # Remove duplicates
            dois = list(set(cleaned_matches))
            print(f"Found {len(dois)} unique DOIs in {file_path}")
            return dois
    except FileNotFoundError:
        print(f"Error: Could not find file {file_path}")
        return []

def get_openalex_data(dois):
    """
    Fetches metadata for a list of DOIs from OpenAlex.
    """
    base_url = "https://api.openalex.org/works"
    results = []
    
    print("Fetching data from OpenAlex...")
    
    for i, doi in enumerate(dois):
        # Create the specific API URL for this DOI
        # Using https://doi.org/ prefix is standard for OpenAlex IDs
        url = f"{base_url}/https://doi.org/{doi}"
        
        params = {'mailto': EMAIL}
        
        try:
            response = requests.get(url, params=params)
            
            if response.status_code == 200:
                data = response.json()
                parsed = parse_paper_data(data, doi)
                results.append(parsed)
                print(f"[{i+1}/{len(dois)}] Success: {doi}")
            elif response.status_code == 404:
                print(f"[{i+1}/{len(dois)}] Not Found: {doi}")
            else:
                print(f"[{i+1}/{len(dois)}] Error {response.status_code}: {doi}")
                
        except Exception as e:
            print(f"[{i+1}/{len(dois)}] Failed to request {doi}: {e}")
            
        # Be polite to the API
        time.sleep(0.1)

    return results

def parse_paper_data(work, original_doi):
    """
    Maps the raw JSON response to the specific columns requested.
    """
    # Helper to safely get nested keys
    def get_safe(obj, path, default=None):
        try:
            for key in path:
                obj = obj[key]
            return obj
        except (KeyError, TypeError, IndexError):
            return default

    # --- parsing logic ---
    
    # Authors
    authorships = work.get('authorships', [])
    author_names = [a.get('author', {}).get('display_name') for a in authorships]
    first_author = author_names[0] if author_names else None
    
    # Institutions (First institution of the first author)
    first_inst = None
    if authorships and authorships[0].get('institutions'):
        first_inst = authorships[0]['institutions'][0].get('display_name')

    # Topics
    topics = work.get('topics', [])
    all_topics = [t.get('display_name') for t in topics]
    primary_topic = all_topics[0] if all_topics else None

    # Concepts (AI tagged)
    concepts = work.get('concepts', [])
    top_concepts = [c.get('display_name') for c in concepts]
    
    # Keywords (New OpenAlex feature, separate from concepts)
    keywords = work.get('keywords', [])
    top_keywords = [k.get('display_name') for k in keywords]

    # Open Access
    oa = work.get('open_access', {})
    
    # FWCI Note: OpenAlex uses "cited_by_percentile_year" which is similar to FWCI 
    # but not the proprietary Elsevier metric. We extract the percentile here.
    fwci_proxy = get_safe(work, ['cited_by_percentile_year', 'min'])

    return {
        'id': work.get('id') or "",
        'doi': original_doi, # Keep the input DOI for reference
        'title': work.get('title') or "",
        'language': work.get('language') or "",
        'type': work.get('type') or "",
        'publication_date': work.get('publication_date') or "",
        'first_author': first_author or "",
        'all_authors': "; ".join(filter(None, author_names)),
        'author_count': len(author_names),
        'first_institution': first_inst or "",
        'venue': get_safe(work, ['primary_location', 'source', 'display_name']) or "",
        'venue_type': get_safe(work, ['primary_location', 'source', 'type']) or "",
        'primary_topic': primary_topic or "",
        'all_topics': "; ".join(filter(None, all_topics)),
        'top_concepts': "; ".join(filter(None, top_concepts[:5])), # Limit to top 5
        'top_keywords': "; ".join(filter(None, top_keywords[:5])), # Limit to top 5
        'cited_by_count': work.get('cited_by_count') if work.get('cited_by_count') is not None else 0,
        'referenced_works_count': work.get('referenced_works_count') if work.get('referenced_works_count') is not None else 0,
        'referenced_works_ids': "; ".join(work.get('referenced_works', [])),
        'fwci': fwci_proxy if fwci_proxy is not None else 0, # Note: This is Citation Percentile, not strict FWCI
        'counts_by_year': str(work.get('counts_by_year', [])),
        'is_open_access': oa.get('is_oa') if oa.get('is_oa') is not None else "",
        'oa_status': oa.get('oa_status') or ""
    }

def main():
    # 1. Extract DOIs from text file
    dois = extract_dois_from_text(INPUT_FILE)
    
    if not dois:
        print("No DOIs found. Please check your input file.")
        return

    # 2. Fetch data
    data = get_openalex_data(dois)
    
    # 3. Save to CSV
    if data:
        df = pd.DataFrame(data)
        # Reorder columns to match user request exactly
        cols = [
            'id','doi','title','language','type','publication_date','first_author',
            'all_authors','author_count','first_institution','venue','venue_type',
            'primary_topic','all_topics','top_concepts','top_keywords','cited_by_count',
            'referenced_works_count','referenced_works_ids','fwci','counts_by_year',
            'is_open_access','oa_status'
        ]
        # Ensure all columns exist (in case of empty data)
        df = df.reindex(columns=cols)
        
        df.to_csv(OUTPUT_FILE, index=False)
        print(f"\nDone! Saved {len(df)} records to {OUTPUT_FILE}")
    else:
        print("No data retrieved.")

if __name__ == "__main__":
    main()