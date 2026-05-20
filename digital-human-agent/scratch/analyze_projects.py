import os
import json
from collections import defaultdict

projects_dir = '/Users/hewei/.gemini/config/projects/'
groups = defaultdict(list)

for filename in os.listdir(projects_dir):
    if filename.endswith('.json'):
        path = os.path.join(projects_dir, filename)
        try:
            with open(path, 'r') as f:
                data = json.load(f)
                name = data.get('name', 'unnamed')
                resources = data.get('projectResources', {}).get('resources', [])
                for res in resources:
                    uri = res.get('gitFolder', {}).get('folderUri')
                    if uri:
                        groups[uri].append({'id': data.get('id'), 'name': name, 'file': filename})
        except Exception as e:
            print(f"Error reading {filename}: {e}")

for uri, projs in groups.items():
    if len(projs) > 1:
        print(f"\nURI: {uri}")
        for p in projs:
            print(f"  - {p['name']} ({p['file']})")
