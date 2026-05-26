import os
import csv

RESULTS_DIR = '/home/tomi/.openclaw/workspace/zrinyi_2026_results'
OUTPUT_FILE = '/home/tomi/.openclaw/workspace/zrinyi_results_2026.csv'

def parse_file(filepath):
    results = []
    with open(filepath, 'r', encoding='latin-1', errors='ignore') as f:
        first_line = f.readline()
        region = first_line.split(':', 1)[1].strip() if ':' in first_line else "Ismeretlen"
        
        headers_found = False
        for line in f:
            if 'Hely' in line and 'N' in line:
                headers_found = True
                continue
            if headers_found and line.strip().startswith('---'):
                break
        
        for line in f:
            if not line.strip() or '---' in line:
                continue
            
            try:
                # Fixed-width columns
                # Név: 6-37
                # Pont (Score): 45-53
                # Prior (Priority): 61-69
                # Iskola (School): 69-115
                name = line[6:37].strip()
                score_str = line[45:53].strip()
                priority_str = line[61:69].strip()
                school = line[69:115].strip()
                
                if name and score_str.isdigit() and priority_str.isdigit():
                    results.append({
                        'Név': name,
                        'Pontszám': int(score_str),
                        'Prioritási pont': int(priority_str),
                        'Iskola': school,
                        'Régió': region
                    })
            except Exception:
                pass
    return results

files = sorted([f for f in os.listdir(RESULTS_DIR) if f.endswith('.txt')])
all_results = []
for filename in files:
    all_results.extend(parse_file(os.path.join(RESULTS_DIR, filename)))

# Order by Score DESC, then Priority Score DESC
all_results.sort(key=lambda x: (x['Pontszám'], x['Prioritási pont']), reverse=True)

# Save to CSV (Excel compatible with semicolon separator for European locales)
with open(OUTPUT_FILE, 'w', encoding='utf-16', newline='') as csvfile:
    fieldnames = ['Régió', 'Név', 'Pontszám', 'Prioritási pont', 'Iskola']
    writer = csv.DictWriter(csvfile, fieldnames=fieldnames, delimiter='\t')
    writer.writeheader()
    writer.writerows(all_results)

print(f"Successfully processed {len(all_results)} entries.")
print(f"Output stored at: {OUTPUT_FILE}")
