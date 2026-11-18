import ezdxf
from ezdxf.math import Vec2
import pathlib
import json
import math

HERE = pathlib.Path(__file__).parent
PROJECT_ROOT = HERE.parent.parent.parent.parent  # geotransv6.0-mobile
PLANTILLA_DIR = HERE / "plantilla"
TEMPLATE_META_PATH = PLANTILLA_DIR / "templates_meta.json"
PREVIEW_DIR = PROJECT_ROOT / "public" / "template_previews"

LAYER_SPECS = {
    'MARCO': 7, 'POLIGONO': 3, 'TEXTOS': 7, 'COTAS': 2, 'GRILLA': 8,
}

TEMPLATE_CONFIGS = [
    {
        'id': 'dwt_standard_a1',
        'name': 'PLANO CATASTRAL A1 (2 VPs)',
        'description': 'Dos viewports: planta principal + croquis ubicacion. Formato A1 horizontal (840x594).',
        'width': 840, 'height': 594, 'margin': 20,
        'vp1_ratio': 0.60, 'vp2_ratio': 0.25,
        'orientation': 'landscape',
    },
    {
        'id': 'dwt_standard_a1_v',
        'name': 'PLANO CATASTRAL A1 VERTICAL',
        'description': 'Formato A1 vertical (594x840). Ideal para lotes alargados.',
        'width': 594, 'height': 840, 'margin': 18,
        'vp1_ratio': 0.62, 'vp2_ratio': 0.22,
        'orientation': 'portrait',
    },
    {
        'id': 'dwt_standard_a2',
        'name': 'PLANO CATASTRAL A2 (2 VPs)',
        'description': 'Formato A2 horizontal (594x420). Para parcelas medianas.',
        'width': 594, 'height': 420, 'margin': 18,
        'vp1_ratio': 0.60, 'vp2_ratio': 0.25,
        'orientation': 'landscape',
    },
    {
        'id': 'dwt_standard_a3',
        'name': 'PLANO CATASTRAL A3 (2 VPs)',
        'description': 'Formato A3 horizontal (420x297). Para levantamientos rapidos.',
        'width': 420, 'height': 297, 'margin': 15,
        'vp1_ratio': 0.58, 'vp2_ratio': 0.25,
        'orientation': 'landscape',
    },
    {
        'id': 'dwt_standard_a0',
        'name': 'PLANO CATASTRAL A0 (2 VPs)',
        'description': 'Formato A0 horizontal (1189x841). Para proyectos de gran envergadura.',
        'width': 1189, 'height': 841, 'margin': 25,
        'vp1_ratio': 0.62, 'vp2_ratio': 0.22,
        'orientation': 'landscape',
    },
    {
        'id': 'dwt_standard_a4',
        'name': 'PLANO CATASTRAL A4 (2 VPs)',
        'description': 'Formato A4 horizontal (297x210). Para fichas rapidas de campo.',
        'width': 297, 'height': 210, 'margin': 12,
        'vp1_ratio': 0.56, 'vp2_ratio': 0.25,
        'orientation': 'landscape',
    },
]


def create_layers(doc):
    for name, color in LAYER_SPECS.items():
        if name not in doc.layers:
            doc.layers.new(name, dxfattribs={'color': color})


def generate_base_template(cfg):
    doc = ezdxf.new('R2010')
    doc.header['$INSUNITS'] = 6
    w, h, margin = cfg['width'], cfg['height'], cfg['margin']
    doc.header['$EXTMIN'] = (0, 0, 0)
    doc.header['$EXTMAX'] = (w, h, 0)

    create_layers(doc)

    doc.header['$TEXTSTYLE'] = 'GEO_ARIAL'

    for style_name, font in [('GEO_ARIAL', 'arial.ttf'), ('STANDARD', 'Arial'), ('GEO_SHX', 'simplex.shx')]:
        if style_name not in doc.styles:
            s = doc.styles.new(style_name)
            s.dxf.font = font
            s.dxf.height = 0
            s.dxf.width = 1

    msp = doc.modelspace()
    iw, ih = w - 2 * margin, h - 2 * margin

    outer = [(0, 0), (w, 0), (w, h), (0, h)]
    msp.add_lwpolyline(outer, close=True, dxfattribs={'layer': 'MARCO'})

    inner = [(margin, margin), (w - margin, margin),
             (w - margin, h - margin), (margin, h - margin)]
    msp.add_lwpolyline(inner, close=True, dxfattribs={'layer': 'MARCO'})

    mid_x = margin + iw * 0.62
    msp.add_line((mid_x, margin), (mid_x, h - margin),
                 dxfattribs={'layer': 'MARCO'})
    msp.add_line((mid_x + iw * 0.12, margin),
                 (mid_x + iw * 0.12, margin + ih * 0.48),
                 dxfattribs={'layer': 'MARCO'})
    msp.add_line((mid_x, margin + ih * 0.48),
                 (w - margin, margin + ih * 0.48),
                 dxfattribs={'layer': 'MARCO'})

    text_h = max(4, min(6, h * 0.01))
    msp.add_text(cfg['name'], dxfattribs={'layer': 'TEXTOS', 'height': text_h, 'style': 'STANDARD'}
                 ).set_placement((margin + 5, h - margin - text_h - 2))

    try:
        layout = doc.layouts.new('PLANO')
    except Exception:
        layout = doc.layouts.get('PLANO')

    vp1_w = iw * cfg['vp1_ratio'] - margin
    vp1_h = ih * 0.94
    vp1_x = margin + vp1_w / 2.0 + 5
    vp1_y = h / 2.0

    vp1 = layout.add_viewport(
        center=(vp1_x, vp1_y),
        size=(vp1_w, vp1_h),
        view_center_point=(0, 0),
        view_height=100,
    )
    vp1.dxf.layer = 'MARCO'

    vp2_x = mid_x + (iw * cfg['vp2_ratio']) / 2.0
    vp2_y = margin + ih * 0.24
    vp2_w = iw * cfg['vp2_ratio'] - margin
    vp2_h = ih * 0.46 - margin

    vp2 = layout.add_viewport(
        center=(vp2_x, vp2_y),
        size=(vp2_w, vp2_h),
        view_center_point=(0, 0),
        view_height=500,
    )
    vp2.dxf.layer = 'MARCO'

    output_path = PLANTILLA_DIR / f"{cfg['id']}.dwt"
    doc.saveas(str(output_path))
    print(f"[OK] Template generated: {output_path}")
    return output_path


def generate_preview_svg(cfg):
    w, h = cfg['width'], cfg['height']
    margin = cfg['margin']
    svg_w, svg_h = 280, int(280 * h / w) if w > 0 else 280
    scale = svg_w / w
    iw, ih = w - 2 * margin, h - 2 * margin
    mid_x = margin + iw * 0.62
    div_y = margin + ih * 0.48

    vp1_w = iw * cfg['vp1_ratio'] - margin
    vp1_h = ih * 0.94
    vp1_x = margin + 5
    vp1_y = (h - vp1_h) / 2.0

    vp2_w = iw * cfg['vp2_ratio'] - margin
    vp2_h = ih * 0.46 - margin
    vp2_x = mid_x
    vp2_y = margin + 2

    orient_label = "HORIZONTAL" if cfg['orientation'] == 'landscape' else "VERTICAL"
    fmt = f"mm   |   {cfg['id'].replace('dwt_standard_', '').upper()}"

    lines = [
        '<svg xmlns="http://www.w3.org/2000/svg"',
        f'  width="{svg_w}" height="{svg_h}"',
        f'  viewBox="0 0 {w} {h}">',
        f'  <defs>',
        f'    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
        f'      <stop offset="0%" stop-color="#0f172a"/>',
        f'      <stop offset="100%" stop-color="#1e293b"/>',
        f'    </linearGradient>',
        f'    <filter id="glow">',
        f'      <feGaussianBlur stdDeviation="{2/scale:.1f}" result="blur"/>',
        f'      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>',
        f'    </filter>',
        f'  </defs>',
        f'  <rect x="0" y="0" width="{w}" height="{h}" fill="url(#bg)" rx="{margin}"/>',
        f'  <rect x="{margin}" y="{margin}" width="{iw}" height="{ih}"',
        f'        fill="none" stroke="#334155" stroke-width="{2/scale:.2f}" rx="2"/>',
        f'  <line x1="{mid_x}" y1="{margin}" x2="{mid_x}" y2="{h - margin}"',
        f'        stroke="#334155" stroke-width="{1/scale:.2f}" stroke-dasharray="{4/scale:.1f}"/>',
        f'  <line x1="{mid_x + iw * 0.12}" y1="{margin}" x2="{mid_x + iw * 0.12}" y2="{div_y}"',
        f'        stroke="#334155" stroke-width="{1/scale:.2f}" stroke-dasharray="{4/scale:.1f}"/>',
        f'  <line x1="{mid_x}" y1="{div_y}" x2="{w - margin}" y2="{div_y}"',
        f'        stroke="#334155" stroke-width="{1/scale:.2f}" stroke-dasharray="{4/scale:.1f}"/>',
        f'  <rect x="{vp1_x}" y="{vp1_y}" width="{vp1_w}" height="{vp1_h}"',
        f'        fill="#0d2b3e" fill-opacity="0.8" stroke="#3b82f6" stroke-width="{2/scale:.2f}" rx="2" filter="url(#glow)"/>',
        f'  <rect x="{vp2_x}" y="{vp2_y}" width="{vp2_w}" height="{vp2_h}"',
        f'        fill="#0d2b3e" fill-opacity="0.8" stroke="#60a5fa" stroke-width="{1.5/scale:.2f}" rx="2" filter="url(#glow)"/>',
        f'  <circle cx="{vp1_x + vp1_w - 15}" cy="{vp1_y + 15}" r="5" fill="#3b82f6" opacity="0.4"/>',
        f'  <text x="{vp1_x + vp1_w - 15}" y="{vp1_y + 18}" text-anchor="middle" fill="#93c5fd"',
        f'        font-family="monospace" font-size="{max(5, h*0.025):.1f}" font-weight="bold">VP1</text>',
        f'  <circle cx="{vp2_x + vp2_w - 12}" cy="{vp2_y + 12}" r="4" fill="#60a5fa" opacity="0.4"/>',
        f'  <text x="{vp2_x + vp2_w - 12}" y="{vp2_y + 14}" text-anchor="middle" fill="#93c5fd"',
        f'        font-family="monospace" font-size="{max(4, h*0.02):.1f}" font-weight="bold">VP2</text>',
        f'  <text x="{w/2}" y="{div_y - 6}" text-anchor="middle" fill="#cbd5e1"',
        f'        font-family="monospace" font-size="{max(7, h*0.035):.1f}" font-weight="bold">{cfg["name"]}</text>',
        f'  <text x="{w/2}" y="{h - 6}" text-anchor="middle" fill="#64748b"',
        f'        font-family="monospace" font-size="{max(6, h*0.025):.1f}">{w}x{h} {fmt} {orient_label}</text>',
        '</svg>',
    ]

    svg_content = '\n'.join(lines)
    preview_path = PREVIEW_DIR / f"{cfg['id']}.svg"
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    preview_path.write_text(svg_content, encoding='utf-8')
    print(f"[OK] Preview generated: {preview_path}")
    return f"template_previews/{cfg['id']}.svg"


def build_meta():
    meta_list = []
    for cfg in TEMPLATE_CONFIGS:
        entry = {
            'id': cfg['id'],
            'name': cfg['name'],
            'description': cfg['description'],
            'metadata_fields': [
                'estado', 'municipio', 'parroquia', 'propietario',
                'profesional', 'area', 'perimetro', 'escala',
            ],
            'preview': f"template_previews/{cfg['id']}.svg",
            'path': f"plantilla/{cfg['id']}.dwt",
        }
        meta_list.append(entry)
    return meta_list


if __name__ == '__main__':
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    meta_list = build_meta()
    for tmpl in meta_list:
        cfg = next(c for c in TEMPLATE_CONFIGS if c['id'] == tmpl['id'])
        generate_base_template(cfg)
        generate_preview_svg(cfg)

    with open(TEMPLATE_META_PATH, 'w', encoding='utf-8') as f:
        json.dump(meta_list, f, indent=2, ensure_ascii=False)

    print(f"[OK] Metadata written to {TEMPLATE_META_PATH}")
