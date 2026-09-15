"""Diagnostic layout contact sheet; approximated connectors, not host screenshots."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

directory = Path('tmp/native-preview')
layouts = json.loads((directory / 'layouts.json').read_text(encoding='utf-8'))
image = Image.new('RGB', (2400, 2400), '#f5f6f8')
draw = ImageDraw.Draw(image)
for index, entry in enumerate(layouts):
    nodes, edges = entry['data']['nodes'], entry['data']['edges']
    ox, oy = index % 2 * 1200, index // 2 * 600
    minx = min(n['x'] for n in nodes) - 50
    miny = min(n['y'] for n in nodes) - 50
    width = max(n['x'] + n['width'] for n in nodes) + 50 - minx
    height = max(n['y'] + n['height'] for n in nodes) + 50 - miny
    scale = min(1150 / width, 520 / height)
    def xy(x, y):
        return (ox + 25 + (1150 - width * scale) / 2 + (x-minx)*scale,
                oy + 55 + (520 - height * scale) / 2 + (y-miny)*scale)
    lookup = {n['id']: n for n in nodes}
    def port(n, side):
        return {'right': (n['x']+n['width'], n['y']+n['height']/2),
                'left': (n['x'], n['y']+n['height']/2),
                'top': (n['x']+n['width']/2, n['y']),
                'bottom': (n['x']+n['width']/2, n['y']+n['height'])}[side]
    for edge in edges:
        start = port(lookup[edge['fromNode']], edge['fromSide'])
        end = port(lookup[edge['toNode']], edge['toSide'])
        if edge['fromSide'] in ('left', 'right'):
            middle = (start[0]+end[0])/2
            p = [start, (middle, start[1]), (middle, end[1]), end]
        else:
            middle = (start[1]+end[1])/2
            p = [start, (start[0], middle), (end[0], middle), end]
        points = []
        for step in range(41):
            t = step/40
            weights = [(1-t)**3, 3*(1-t)**2*t, 3*(1-t)*t*t, t**3]
            points.append(xy(*(sum(q[k]*w for q,w in zip(p, weights)) for k in (0, 1))))
        draw.line(points, fill=edge.get('color', '#808080'), width=2)
    for n in nodes:
        color = n.get('color') or '#596171'
        draw.rounded_rectangle([xy(n['x'], n['y']), xy(n['x']+n['width'], n['y']+n['height'])],
                               radius=max(2, 8*scale), fill='#ffffff', outline=color, width=1)
        size = [28, 21, 18][min(2, n['canvasMindMap']['depth'])]
        font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', max(7, round(size*scale)))
        draw.text(xy(n['x']+n['width']/2, n['y']+n['height']/2), n['text'], fill=color, font=font, anchor='mm')
    draw.text((ox+25, oy+15), entry['layout']+' / STATIC GEOMETRY', fill='#444444',
              font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 20))
image.save(directory / 'layouts.png')
print(directory / 'layouts.png')
