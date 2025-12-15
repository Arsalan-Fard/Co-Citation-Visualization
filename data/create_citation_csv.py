import pandas as pd
import requests
import time
import sys
import os

EMAIL = "arsalan.masoudifard@ip-paris.fr"
INPUT_FILE = "data/main_papers.csv"
OUTPUT_FILE = "data/citation.csv"

def get_work_details(work_id):
    url = f"https://api.openalex.org/works/{work_id}"
    try:
        response = requests.get(url, params={'mailto': EMAIL})
        if response.status_code == 200:
            return response.json()
        elif response.status_code == 404:
            pass
        else:
            pass
    except Exception as e:
        pass
    return None

def get_citations(api_url):
    citations = []
    per_page = 200
    cursor = '*'

    base_url = api_url
    if '?' not in base_url:
        base_url += '?'
    else:
        base_url += '&'

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

                if not next_cursor or len(results) < per_page:
                    break

                cursor = next_cursor
                time.sleep(0.1)
            else:
                break
        except Exception as e:
            break

    return citations

def main():
    if not os.path.exists(INPUT_FILE):
        return

    try:
        df = pd.read_csv(INPUT_FILE)
    except Exception as e:
        return

    all_rows = []

    for idx, row in df.iterrows():
        source_id_url = row.get('id')
        if not source_id_url:
            continue

        work = get_work_details(source_id_url)
        if not work:
            continue

        primary_topic = work.get('primary_topic') or {}
        topic_name = primary_topic.get('display_name', '')
        subfield_name = primary_topic.get('subfield', {}).get('display_name', '')
        field_name = primary_topic.get('field', {}).get('display_name', '')

        authors_data = []
        for authorship in work.get('authorships', []):
            author = authorship.get('author', {})
            institutions = authorship.get('institutions', [])
            inst_names = "; ".join([inst.get('display_name', '') for inst in institutions])

            authors_data.append({
                'author_id': author.get('id'),
                'author_name': author.get('display_name'),
                'institutions': inst_names
            })

        if not authors_data:
            authors_data.append({
                'author_id': '',
                'author_name': '',
                'institutions': ''
            })

        cited_url = row.get('cited_by_api_url')

        if pd.isna(cited_url) or not cited_url:
            w_id = source_id_url.split('/')[-1]
            cited_url = f"https://api.openalex.org/works?filter=cites:{w_id}"

        citations = get_citations(cited_url)

        if not citations:
            continue

        for citation in citations:
            citing_id = citation.get('id')
            citing_name = citation.get('title')

            c_primary_topic = citation.get('primary_topic') or {}
            c_topic_name = c_primary_topic.get('display_name', '')
            c_subfield_name = c_primary_topic.get('subfield', {}).get('display_name', '')
            c_field_name = c_primary_topic.get('field', {}).get('display_name', '')

            c_authorships = citation.get('authorships', [])

            cited_count = citation.get('cited_by_count', 0)

            publication_date = citation.get('publication_date', '')

            if not c_authorships:
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
                    'citing_paper_publication_date': publication_date,
                    'cited_by_count': cited_count,
                    'relationship': 'incoming'
                }
                all_rows.append(new_row)
            else:
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
                    'citing_paper_publication_date': publication_date,
                    'cited_by_count': cited_count,
                    'relationship': 'incoming'
                }
                all_rows.append(new_row)

    if all_rows:
        out_df = pd.DataFrame(all_rows)
        cols = ['source_paper_id','author_id','author_name','institutions','paper_subfield',
                'paper_field','paper_topic','citing_paper_id','citing_paper_name','citing_paper_publication_date','cited_by_count','relationship']

        out_df = out_df[cols]

        out_df.to_csv(OUTPUT_FILE, index=False, encoding='utf-8')

if __name__ == "__main__":
    main()
