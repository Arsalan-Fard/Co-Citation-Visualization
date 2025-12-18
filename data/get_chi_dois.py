import requests
import time

EMAIL = "arsalan.masoudifard@ip-paris.fr"
OUTPUT_FILE = "dois_hci.txt"
TARGET_COUNT = 200

def get_chi_venue_id():
    """
    Finds the OpenAlex ID for the CHI conference.
    """
    url = "https://api.openalex.org/sources"
    params = {
        "search": "Conference on Human Factors in Computing Systems",
        "mailto": EMAIL
    }
    print("Searching for CHI venue ID...")
    try:
        res = requests.get(url, params=params)
        if res.status_code == 200:
            results = res.json().get('results', [])
            for r in results:
                # CHI usually has "CHI" or the full name in display_name
                # The main proceedings source is what we want.
                if "Human Factors in Computing Systems" in r.get('display_name', ''):
                    print(f"Found Venue: {r.get('display_name')} ({r['id']})")
                    return r['id']
    except Exception as e:
        print(f"Error searching venue: {e}")
    
    return None

def get_random_dois(venue_id, count=200):
    """
    Retrieves random DOIs from the specified venue.
    Uses OpenAlex 'sample' parameter for randomness.
    """
    url = "https://api.openalex.org/works"
    
    # Filter for the venue and a broad year range (e.g., last 15 years) to ensure "different years"
    # Filtering by type='proceedings-article' or 'article' might be good, but venue filter is strong enough usually.
    filters = f"primary_location.source.id:{venue_id},publication_year:2010-2024"
    
    params = {
        "filter": filters,
        "sample": count, # Request exactly the sample size we want
        "mailto": EMAIL,
        "per_page": count
    }
    
    print(f"Fetching {count} random papers from 2010-2024...")
    dois = []
    
    try:
        res = requests.get(url, params=params)
        if res.status_code == 200:
            results = res.json().get('results', [])
            print(f"Received {len(results)} results.")
            
            for work in results:
                doi = work.get('doi')
                if doi:
                    # Clean DOI: remove https://doi.org/ prefix if desired, or keep it.
                    # Usually standard DOIs in text files are just the ID (10.xxx/yyy)
                    clean_doi = doi.replace('https://doi.org/', '')
                    dois.append(clean_doi)
        else:
            print(f"API Error: {res.status_code} - {res.text}")
            
    except Exception as e:
        print(f"Error fetching works: {e}")
        
    return dois

def main():
    venue_id = get_chi_venue_id()
    if not venue_id:
        print("Could not find CHI venue ID. Exiting.")
        return

    dois = get_random_dois(venue_id, TARGET_COUNT)
    
    if dois:
        print(f"Writing {len(dois)} DOIs to {OUTPUT_FILE}...")
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            for doi in dois:
                f.write(doi + '\n')
        print("Done.")
    else:
        print("No DOIs found.")

if __name__ == "__main__":
    main()
