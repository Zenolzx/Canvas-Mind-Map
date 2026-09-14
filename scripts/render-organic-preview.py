"""Static geometry QA from the layout result; not an Obsidian screenshot."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

directory = Path('tmp/organic-preview')
layout = json.loads((directory / 'layout.json').read_text(encoding='utf-8'))
b = layout['bounds']
scale = min(1800 / b['width'], 1100 / b['height'])
image = Image.new('RGB', (1800, 1160), '#fffaf4')
draw = ImageDraw.Draw(image)
ox = (1800 - b['width'] * scale) / 2 - b['x'] * scale
oy = 60 + (1100 - b['height'] * scale) / 2 - b['y'] * scale
def xy(x, y): return (x * scale + ox, y * scale + oy)
for edge in layout['branches']:
    p = [edge[k] for k in ['start', 'control1', 'control2', 'end']]
    curve = []
    for step in range(101):
        t = step / 100
        weights = [(1-t)**3, 3*(1-t)**2*t, 3*(1-t)*t*t, t**3]
        curve.append(xy(sum(q['x']*w for q, w in zip(p, weights)), sum(q['y']*w for q, w in zip(p, weights))))
    draw.line(curve, fill=edge['color'], width=max(1, round(edge['width'] * scale)))
for node in layout['nodes']:
    x, y, width, height = (node[k] for k in ['x', 'y', 'width', 'height'])
    if node['depth'] == 0:
        draw.rounded_rectangle([xy(x, y), xy(x+width, y+height)], radius=18*scale, fill='#f7efe4', outline='#c6b9a6', width=2)
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', max(8, round(node['fontSize']*scale)))
    top = (height - len(node['lines']) * node['fontSize'] * 1.4)/2
    for i, line in enumerate(node['lines']):
        draw.text(xy(x+width/2, y+top+i*node['fontSize']*1.4), line, font=font, fill=node['color'], anchor='mt')
draw.text((32, 20), 'ORGANIC MIND MAP / STATIC GEOMETRY QA', fill='#8b8378', font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 16))
image.save(directory / 'layout.png')
print(directory / 'layout.png')
