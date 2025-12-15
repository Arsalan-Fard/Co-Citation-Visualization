import pandas as pd
import requests
import time
import sys
import os

EMAIL = "arsalan.masoudifard@ip-paris.fr"
INPUT_FILE = "Phase1/main_papers.csv"
OUTPUT_FILE = "Phase1/references.csv"

def get_references(source_work_id):
    references = []
    per_page = 200
    cursor = '*'

    w_id = source_work_id.split('/')[-1]

    base_url = f"https://api.openalex.org/works?filter=cited_by:{w_id}"

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

                if not next_cursor or len(results) < per_page:
                    break

                cursor = next_cursor
                time.sleep(0.1)
            else:
                break
        except Exception as e:
            break

    return references

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

        references = get_references(source_id_url)

        if not references:
            continue

        for ref_work in references:
            ref_id = ref_work.get('id')
            ref_title = ref_work.get('title')

            r_primary_topic = ref_work.get('primary_topic') or {}
            r_topic_name = r_primary_topic.get('display_name', '')
            r_subfield_name = r_primary_topic.get('subfield', {}).get('display_name', '')
            r_field_name = r_primary_topic.get('field', {}).get('display_name', '')

            r_authorships = ref_work.get('authorships', [])

            if not r_authorships:
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

    if all_rows:
        out_df = pd.DataFrame(all_rows)
        cols = ['source_paper_id','author_id','author_name','institutions','paper_subfield',
                'paper_field','paper_topic','referenced_paper_id','referenced_paper_name','relationship']

        out_df = out_df[cols]

        out_df.to_csv(OUTPUT_FILE, index=False, encoding='utf-8')

if __name__ == "__main__":
    main()
