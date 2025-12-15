import requests
import pandas as pd
import re
import time

EMAIL = "arsalan.masoudifard@ip-paris.fr"
INPUT_FILE = "data/dois.txt"
OUTPUT_FILE = "main_papers.csv"

def extract_dois_from_text(file_path):
    dois = []
    doi_pattern = r'\b(10\.\d{4,9}/[-._;()/:A-Z0-9]+)\b'

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            text = f.read()
            matches = re.findall(doi_pattern, text, re.IGNORECASE)
            cleaned_matches = [m.rstrip('.') for m in matches]
            dois = list(set(cleaned_matches))
            return dois
    except FileNotFoundError:
        return []

def get_openalex_data(dois):
    base_url = "https://api.openalex.org/works"
    results = []

    for i, doi in enumerate(dois):
        url = f"{base_url}/https://doi.org/{doi}"

        params = {'mailto': EMAIL}

        try:
            response = requests.get(url, params=params)

            if response.status_code == 200:
                data = response.json()
                parsed = parse_paper_data(data, doi)
                results.append(parsed)
            elif response.status_code == 404:
                pass
            else:
                pass

        except Exception as e:
            pass

        time.sleep(0.1)

    return results

def parse_paper_data(work, original_doi):
    def get_safe(obj, path, default=None):
        try:
            for key in path:
                obj = obj[key]
            return obj
        except (KeyError, TypeError, IndexError):
            return default

    authorships = work.get('authorships', [])
    author_names = [a.get('author', {}).get('display_name') for a in authorships]
    first_author = author_names[0] if author_names else None

    first_inst = None
    if authorships and authorships[0].get('institutions'):
        first_inst = authorships[0]['institutions'][0].get('display_name')

    topics = work.get('topics', [])
    primary_topic_obj = topics[0] if topics else {}
    
    primary_topic_name = primary_topic_obj.get('display_name')
    
    # Extract hierarchy
    domain_name = get_safe(primary_topic_obj, ['domain', 'display_name'])
    field_name = get_safe(primary_topic_obj, ['field', 'display_name'])
    subfield_name = get_safe(primary_topic_obj, ['subfield', 'display_name'])

    all_topics = [t.get('display_name') for t in topics]

    concepts = work.get('concepts', [])
    top_concepts = [c.get('display_name') for c in concepts]

    keywords = work.get('keywords', [])
    top_keywords = [k.get('display_name') for k in keywords]

    oa = work.get('open_access', {})

    fwci_proxy = get_safe(work, ['cited_by_percentile_year', 'min'])

    return {
        'id': work.get('id') or "",
        'doi': original_doi,
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
        'primary_topic': primary_topic_name or "",
        'domain': domain_name or "",
        'field': field_name or "",
        'subfield': subfield_name or "",
        'all_topics': "; ".join(filter(None, all_topics)),
        'top_concepts': "; ".join(filter(None, top_concepts[:5])),
        'top_keywords': "; ".join(filter(None, top_keywords[:5])),
        'cited_by_count': work.get('cited_by_count') if work.get('cited_by_count') is not None else 0,
        'referenced_works_count': work.get('referenced_works_count') if work.get('referenced_works_count') is not None else 0,
        'referenced_works_ids': "; ".join(work.get('referenced_works', [])),
        'fwci': fwci_proxy if fwci_proxy is not None else 0,
        'counts_by_year': str(work.get('counts_by_year', [])),
        'is_open_access': oa.get('is_oa') if oa.get('is_oa') is not None else "",
        'oa_status': oa.get('oa_status') or ""
    }

def main():
    dois = extract_dois_from_text(INPUT_FILE)

    if not dois:
        print("No DOIs found.")
        return

    print(f"Fetching data for {len(dois)} DOIs...")
    data = get_openalex_data(dois)

    if data:
        df = pd.DataFrame(data)
        
        # Preserve 'read' column if exists
        try:
            existing_df = pd.read_csv(OUTPUT_FILE)
            if 'read' in existing_df.columns:
                print("Preserving 'read' status from existing file...")
                # Create map from DOI to read status
                # Normalize DOI just in case, though usually exact match in this script context
                read_map = dict(zip(existing_df['doi'], existing_df['read']))
                df['read'] = df['doi'].map(read_map).fillna(0).astype(int, errors='ignore') # Default to 0/empty if new
            else:
                df['read'] = 0
        except FileNotFoundError:
            df['read'] = 0

        cols = [
            'id','doi','title','language','type','publication_date','first_author',
            'all_authors','author_count','first_institution','venue','venue_type',
            'primary_topic','domain','field','subfield','all_topics','top_concepts','top_keywords','cited_by_count',
            'referenced_works_count','referenced_works_ids','fwci','counts_by_year',
            'is_open_access','oa_status','read'
        ]
        
        # Ensure all cols exist (e.g. if API failed for all)
        for c in cols:
            if c not in df.columns:
                df[c] = ""

        df = df.reindex(columns=cols)

        df.to_csv(OUTPUT_FILE, index=False)
        print(f"Saved {len(df)} papers to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
