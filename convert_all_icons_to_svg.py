import re
import os

# Map symbolic color names to RGB hex values (example values, update as needed)
COLOR_MAP = {
    'DIS_BG': '#e0e0e0',      # Example: light gray
    'DIS_CH': '#ffffff',      # White
    'DIS_FD': '#e0e0e0',      # Same as DIS_BG
    'DIS_HL': '#4576a0',      # Example: blue highlight
    'DIS_RD': '#ff0000',      # Red
    'DIS_TG': '#be9c00',      # Example: gold
    'DIS_TB': '#ffffff',      # White
    'DIS_SN': '#ffff00',      # Yellow
}

# Directory containing DisSymbol.c
C_SOURCE = '../T3-programmable-controller-on-ESP32/main/DisSymbol.c'
# Output directory for SVGs
OUT_DIR = 'Icons'
os.makedirs(OUT_DIR, exist_ok=True)

# Regex to match icon arrays and their sizes
def extract_icons(c_file):
    with open(c_file, 'r', encoding='utf-8', errors='ignore') as f:
        text = f.read()
    # Match arrays like: uint16 const iconname[] = { ... };
    pattern = re.compile(r'(?:const\s+\w+|\w+\s+const)\s+(\w+)\s*\[\s*\]\s*=\s*\{([^}]*)\};', re.MULTILINE | re.DOTALL)
    icons = []
    # Load icon dimensions from icon_list.json
    import json
    with open('icon_list.json', 'r', encoding='utf-8') as jf:
        icon_meta = {i['name']: (i['width'], i['height']) for i in json.load(jf)}
    for match in pattern.finditer(text):
        name, data = match.groups()
        if name not in icon_meta:
            continue
        w, h = icon_meta[name]
        # Clean up data: remove comments, whitespace, split by comma
        data = re.sub(r'/\*.*?\*/', '', data, flags=re.DOTALL)
        data = [x.strip() for x in data.replace('\n', '').split(',') if x.strip()]
        icons.append({'name': name, 'width': w, 'height': h, 'data': data})
    return icons

def color_to_hex(val):
    # If it's a macro, use the color map
    if val in COLOR_MAP:
        return COLOR_MAP[val]
    # If it's a hex value (e.g., 0xFFFF), convert RGB565 to hex
    if val.startswith('0x'):
        v = int(val, 16)
        r = ((v >> 11) & 0x1F) * 255 // 31
        g = ((v >> 5) & 0x3F) * 255 // 63
        b = (v & 0x1F) * 255 // 31
        return f'#{r:02x}{g:02x}{b:02x}'
    # Fallback: black
    return '#000000'

def icon_to_svg(icon):
    w, h = icon['width'], icon['height']
    data = icon['data']
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" shape-rendering="crispEdges">']
    for y in range(h):
        for x in range(w):
            idx = y * w + x
            if idx >= len(data):
                continue
            color = color_to_hex(data[idx])
            svg.append(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{color}"/>')
    svg.append('</svg>')
    return '\n'.join(svg)

def main():
    icons = extract_icons(C_SOURCE)
    for icon in icons:
        svg = icon_to_svg(icon)
        out_path = os.path.join(OUT_DIR, f"{icon['name']}.svg")
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(svg)
    # Also write a manifest
    manifest = [
        {'name': icon['name'], 'width': icon['width'], 'height': icon['height']} for icon in icons
    ]
    import json
    with open(os.path.join(OUT_DIR, 'icon_list.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
    print(f"Exported {len(icons)} icons to SVG in {OUT_DIR}/")

if __name__ == '__main__':
    main()
