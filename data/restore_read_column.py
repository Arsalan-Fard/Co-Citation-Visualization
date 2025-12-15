import pandas as pd

# Load the current main papers (with new columns but potential wrong read status)
df_main = pd.read_csv('data/main_papers.csv')

# Load the backup papers (with correct read status)
df_backup = pd.read_csv('data/main_papers_2.csv')

# Create a mapping from DOI to 'read' status from the backup
# We use DOI as the unique key. If ID is more reliable, we could use that.
# Assuming 'doi' column exists in both.
read_map = dict(zip(df_backup['doi'], df_backup['read']))

# Update the 'read' column in df_main
# We map the DOIs in df_main to the values in read_map.
# If a DOI in main isn't in backup, we keep its existing value (or set to 0 if preferred, but existing is safer)
df_main['read'] = df_main['doi'].map(read_map).fillna(df_main['read'])

# Save back to main_papers.csv
df_main.to_csv('data/main_papers.csv', index=False)

print(f"Restored 'read' column values for {len(df_main)} papers.")
