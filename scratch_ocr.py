import sys
import glob
from vision import extract_text_from_frames
import json

with open('scratch_ocr_out.txt', 'w', encoding='utf-8') as out:
    for d in ['DdEzfn-jV09', 'Dc_dKPBABsx', 'DdF85HXm4ya']:
        out.write(f'\\n--- {d} ---\\n')
        frames = sorted(glob.glob(f'ground_truth/{d}/frame_*.jpg'))
        with open(f'ground_truth/{d}/manifest.json', encoding='utf-8') as f:
            manifest = json.load(f)
            out.write('CAPTION: ' + manifest.get('caption', '') + '\\n')
        res = extract_text_from_frames(frames)
        # res is a dict: {'fullText': ..., 'links': ...} or similar. I'll just write it as JSON.
        out.write('OCR TEXT:\\n')
        out.write(json.dumps(res, indent=2, ensure_ascii=False) + '\\n')
