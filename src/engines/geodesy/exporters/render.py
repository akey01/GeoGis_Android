import sys
import urllib.parse
import json
import math
import datetime
import pathlib
from pathlib import Path
import os
import ezdxf
from ezdxf.math import Matrix44
try:
    from ezdxf.enums import TextEntityAlignment
except Exception:
    # Fallback for older ezdxf versions without enums
    from ezdxf import const as _const
    class TextEntityAlignment:
        LEFT = _const.TEXT_ALIGNMENT_LEFT
        MIDDLE_CENTER = _const.TEXT_ALIGNMENT_MIDDLE_CENTER
# Configure ezdxf to locate SHX font files
ezdxf.options.support_dir = str(Path(__file__).parent / "fonts")
print(f"[DB] DXF Support Dir set to: {ezdxf.options.support_dir}", file=sys.stderr)
import unicodedata
import re
import io as _io

# ── Caché de template DXF (en memoria, por proceso Python) ──────────────────────
# Guarda el template original serializado como bytes (antes de eliminar entidades).
# Evita readfile() en cada request: ahorra ~0.5-1 s por generación de DXF.
_TEMPLATE_CACHE: dict = {}  # {template_path: bytes}
# ──────────────────────────────────────────────────────────────────────────────


def detect_epsg_regven(cx_utm: float) -> int:
    """Detecta el EPSG REGVEN según la coordenada Este del centroide (Venezuela: Zonas 19N=2201, 20N=2202, 21N=2203)."""
    if cx_utm < 500_000:
        return 2201
    elif cx_utm < 1_000_000:
        return 2202
    else:
        return 2203


# ── Croquis de Ubicación Vectorial Nativo (SUNAC / IGVSB) ──────────────────────
# La exportación DXF utiliza un croquis vectorial nativo de ubicación a escala
# reducida (1:5000) con el contorno de la parcela, vértices y rosa de los vientos,
# garantizando un archivo 100% portable y autónomo para cualquier versión de CAD.
# ──────────────────────────────────────────────────────────────────────────────

def clean_text(value, fallback=''):
    if value is None:
        return fallback
    val_str = str(value)
    # Normalize NFKD to strip accents/diacritics
    nfkd_form = unicodedata.normalize('NFKD', val_str)
    only_ascii = nfkd_form.encode('ASCII', 'ignore').decode('ASCII')
    # Keep only safe standard drawing chars
    cleaned = re.sub(r'[^a-zA-Z0-9.,:/()#°\'" \-]', '', only_ascii)
    return cleaned.strip()

def validate_layers(doc):
    """Validate that essential layers exist in the DXF document.
    Logs warnings to stderr if any are missing and creates them with default colors.
    """
    required_layers = {
        'MARCO': 7,
        'POLIGONO': 10,
        'TEXTOS': 7,
        'GRILLA': 8,
        'COTAS': 230,
        'NOTAS': 7,
    }
    for layer_name, color in required_layers.items():
        if layer_name not in doc.layers:
            doc.layers.new(layer_name, dxfattribs={'color': color})
            print(f"[WARN] Layer '{layer_name}' was missing and has been created.", file=sys.stderr)


def format_number(value, decimals=3):
    try:
        val_float = float(value)
        if math.isfinite(val_float):
            return f"{val_float:.{decimals}f}"
        return f"{0.0:.{decimals}f}"
    except Exception:
        return f"{0.0:.{decimals}f}"

def get_bearing(dx, dy):
    angle_rad = math.atan2(abs(dx), abs(dy))
    angle_deg = math.degrees(angle_rad)
    d = math.floor(angle_deg)
    m_float = (angle_deg - d) * 60.0
    m = math.floor(m_float)
    s = (m_float - m) * 60.0
    ns = 'N' if dy >= 0 else 'S'
    ew = 'E' if dx >= 0 else 'W'
    return f"{ns} {d:02d}°{m:02d}'{s:05.2f}\" {ew}"

def get_bearing_deg(dx, dy):
    angle_rad = math.atan2(dx, dy)
    angle_deg = math.degrees(angle_rad)
    if angle_deg < 0:
        angle_deg += 360.0
    return format_number(angle_deg, 2)

def nice_step(value_range):
    if not math.isfinite(value_range) or value_range <= 0:
        return 10.0
    raw = value_range / 3.0
    power = 10.0 ** math.floor(math.log10(raw))
    normalized = raw / power
    if normalized <= 1.0:
        return power
    elif normalized <= 2.0:
        return 2.0 * power
    elif normalized <= 5.0:
        return 5.0 * power
    else:
        return 10.0 * power

def calculate_geometry(points):
    area = 0.0
    perim = 0.0
    n = len(points)
    for i in range(n):
        p1 = points[i]
        p2 = points[(i + 1) % n]
        area += p1['x'] * p2['y'] - p2['x'] * p1['y']
        perim += math.hypot(p2['x'] - p1['x'], p2['y'] - p1['y'])
    return {'area': area / 2.0, 'perim': perim, 'signedArea': area / 2.0}

def draw_line(msp, x1, y1, x2, y2, layer='MARCO', linetype=None, **kwargs):
    attribs = {'layer': layer}
    if linetype:
        attribs['linetype'] = linetype
    msp.add_line((x1, y1), (x2, y2), dxfattribs=attribs)

def draw_circle(msp, cx, cy, radius, layer='TEXTOS', **kwargs):
    msp.add_circle((cx, cy), radius, dxfattribs={'layer': layer})

def draw_rect(msp, x, y, w, h, thickness=0.0, layer='MARCO', **kwargs):
    pts = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    attribs = {'layer': layer}
    if thickness > 0:
        attribs['const_width'] = thickness
    msp.add_lwpolyline(pts, close=True, dxfattribs=attribs)

def draw_left_text(msp, x, y, height, text, rotation=0, layer='TEXTOS', style='GEO_ARIAL'):
    t = msp.add_text(text, dxfattribs={'layer': layer, 'height': height, 'rotation': rotation, 'color': 7, 'style': style})
    t.set_placement((x, y), align=TextEntityAlignment.LEFT)
    return t

def draw_centered_text(msp, x, y, height, text, rotation=0, layer='TEXTOS', style='GEO_ARIAL'):
    t = msp.add_text(text, dxfattribs={'layer': layer, 'height': height, 'rotation': rotation, 'color': 7, 'style': style})
    t.set_placement((x, y), align=TextEntityAlignment.MIDDLE_CENTER)
    return t

def draw_cell_text(msp, x, y, height, text, rotation=0, layer='TEXTOS', style='GEO_ARIAL'):
    t = msp.add_text(text, dxfattribs={'layer': layer, 'height': height, 'rotation': rotation, 'color': 7, 'style': style})
    t.set_placement((x, y), align=TextEntityAlignment.MIDDLE_CENTER)
    return t

def draw_compass_rose(msp, cx, cy, size, doc=None, has_template_blocks=False, style='GEO_ARIAL'):
    if has_template_blocks and doc and 'NORTE' in doc.blocks:
        try:
            scale = size / 5.5
            insert_x = cx - 700.96 * scale
            insert_y = cy - 488.98 * scale
            msp.add_blockref('NORTE', (insert_x, insert_y), dxfattribs={
                'xscale': scale,
                'yscale': scale,
                'layer': 'TEXTOS'
            })
            return
        except Exception as e:
            print(f"Failed to insert block NORTE: {e}", file=sys.stderr)
            
    # Fallback to simple geometric rose
    draw_circle(msp, cx, cy, size * 0.5, layer='TEXTOS')
    draw_circle(msp, cx, cy, size * 0.4, layer='TEXTOS')
    draw_line(msp, cx, cy + size, cx + size * 0.15, cy + size * 0.15, layer='TEXTOS')
    draw_line(msp, cx, cy + size, cx - size * 0.15, cy + size * 0.15, layer='TEXTOS')
    draw_line(msp, cx, cy - size, cx + size * 0.15, cy - size * 0.15, layer='TEXTOS')
    draw_line(msp, cx, cy - size, cx - size * 0.15, cy - size * 0.15, layer='TEXTOS')
    draw_line(msp, cx + size, cy, cx + size * 0.15, cy + size * 0.15, layer='TEXTOS')
    draw_line(msp, cx + size, cy, cx + size * 0.15, cy - size * 0.15, layer='TEXTOS')
    draw_line(msp, cx - size, cy, cx - size * 0.15, cy + size * 0.15, layer='TEXTOS')
    draw_line(msp, cx - size, cy, cx - size * 0.15, cy - size * 0.15, layer='TEXTOS')
    
    text_h = size * 0.3
    draw_centered_text(msp, cx, cy + size * 1.2, text_h, 'N', layer='TEXTOS', style=style)
    draw_centered_text(msp, cx, cy - size * 1.5, text_h, 'S', layer='TEXTOS', style=style)
    draw_centered_text(msp, cx + size * 1.3, cy - text_h * 0.5, text_h, 'E', layer='TEXTOS', style=style)
    draw_centered_text(msp, cx - size * 1.3, cy - text_h * 0.5, text_h, 'O', layer='TEXTOS', style=style)


# ══════════════════════════════════════════════════════════════════════════════
# FUNCIONES DXF PROFESIONALES (Fase 2)
# ══════════════════════════════════════════════════════════════════════════════

def draw_hatch_polygon(msp, doc, pts, layer='HATCH', color=253):
    """
    Paso 6 — Dibuja un HATCH (relleno sólido semi-transparente) sobre el polígono.
    Solo para polígonos cerrados con 3+ vértices. Usa edge_path con segmentos LINE
    para máxima compatibilidad con AutoCAD 2010+.
    """
    if len(pts) < 3:
        return
    # Asegurar que la capa HATCH existe
    if layer not in doc.layers:
        doc.layers.new(layer, dxfattribs={'color': color, 'linetype': 'CONTINUOUS'})
    try:
        hatch = msp.add_hatch(color=color, dxfattribs={'layer': layer})
        hatch.set_pattern_fill('SOLID')
        # Construir edge_path con segmentos LINE entre vértices consecutivos
        edge_path = hatch.paths.add_edge_path()
        n = len(pts)
        for i in range(n):
            p1 = pts[i]
            p2 = pts[(i + 1) % n]
            edge_path.add_line((p1['x'], p1['y']), (p2['x'], p2['y']))
        # Aplicar transparencia (70% trans → 30% visible)
        # ezdxf almacena transparencia como entero 0-90 (porcentaje)
        try:
            hatch.dxf.transparency = 0.70  # 70% transparente
        except Exception:
            pass
        print(f"[DXF] HATCH dibujado en capa {layer} con {n} vértices", file=sys.stderr)
    except Exception as e:
        print(f"[DXF] HATCH fallido (polígono cóncavo o auto-intersección): {e}", file=sys.stderr)


def draw_scale_bar(msp, x, y, print_scale, width, text_h, layer='COTAS', style='GEO_ARIAL'):
    """
    Paso 7 — Dibuja una barra de escala gráfica como entidades DXF.
    La barra representa distancias reales en papel en la escala del plano.
    x, y: posición inferior izquierda de la barra.
    print_scale: escala del plano (e.g. 500 para 1:500).
    width: ancho total disponible para la barra en unidades del plano.
    """
    # Determinar el valor representativo: ~25% del ancho disponible en metros reales
    bar_real_m = width / print_scale * 0.25  # metros reales
    # Redondear a valor "bonito"
    magnitude = 10.0 ** math.floor(math.log10(max(bar_real_m, 1.0)))
    nice = bar_real_m / magnitude
    if nice <= 1.0: nice_val = 1.0 * magnitude
    elif nice <= 2.0: nice_val = 2.0 * magnitude
    elif nice <= 5.0: nice_val = 5.0 * magnitude
    else: nice_val = 10.0 * magnitude

    bar_len = nice_val * print_scale  # longitud en unidades del plano
    seg_len = bar_len / 5.0            # 5 segmentos
    tick_h = text_h * 0.8

    # Dibujar la línea base de la barra
    msp.add_line((x, y), (x + bar_len, y), dxfattribs={'layer': layer})
    # Dibujar ticks verticales en cada segmento
    for i in range(6):
        tx = x + i * seg_len
        msp.add_line((tx, y), (tx, y + tick_h), dxfattribs={'layer': layer})
    # Alternar relleno oscuro/claro (bloques alternados)
    for i in range(5):
        if i % 2 == 0:
            rect_pts = [
                (x + i * seg_len, y),
                (x + (i + 1) * seg_len, y),
                (x + (i + 1) * seg_len, y + tick_h),
                (x + i * seg_len, y + tick_h),
            ]
            msp.add_lwpolyline(rect_pts, close=True, dxfattribs={'layer': layer, 'const_width': 0})
    # Etiquetas
    draw_left_text(msp, x, y + tick_h * 1.3, text_h * 0.75, '0', layer=layer, style=style)
    draw_centered_text(msp, x + bar_len / 2.0, y + tick_h * 1.3, text_h * 0.75,
                       f"{int(nice_val / 2)} m", layer=layer, style=style)
    draw_left_text(msp, x + bar_len - text_h * 0.5, y + tick_h * 1.3, text_h * 0.75,
                   f"{int(nice_val)} m", layer=layer, style=style)
    # Etiqueta de escala debajo
    draw_centered_text(msp, x + bar_len / 2.0, y - text_h * 1.5, text_h,
                       f"ESCALA 1:{int(print_scale)}", layer=layer, style=style)
    print(f"[DXF] Barra de escala 1:{int(print_scale)} dibujada (len={bar_len:.1f}, rep={int(nice_val)}m)", file=sys.stderr)


def draw_membrete(msp, box_x, box_y, box_w, box_h, metadata, print_scale, fecha,
                  layer='MARCO', text_layer='TEXTOS', style='GEO_ARIAL'):
    """
    Paso 8 — Dibuja cuadro de membrete profesional venezolano en la esquina inferior derecha.
    Celdas: Número de Plano, Escala, Fecha, Revisión, Profesional, CIV, Municipio, Estado.
    """
    profesional = metadata.get('profesional', 'ING. CATASTRAL')
    civ = metadata.get('civ', 'C.I.V.')
    municipio = metadata.get('municipio', '')
    estado = metadata.get('estado', '')
    numero_plano = metadata.get('numeroplano', 'GT-001')
    revision = metadata.get('revision', '0')

    # Limpieza
    def ct(v, fb=''):
        return clean_text(str(v) if v else fb, fb).upper()

    rows = [
        ('N DE PLANO', ct(numero_plano, 'GT-001')),
        ('ESCALA',     f'1:{int(print_scale)}'),
        ('FECHA',      ct(fecha, datetime.date.today().strftime('%d/%m/%Y'))),
        ('REVISION',   ct(revision, '0')),
        ('PROFESIONAL', ct(profesional, 'ING. CATASTRAL')),
        ('C.I.V.',     ct(civ, '')),
        ('MUNICIPIO',  ct(municipio, '')),
        ('ESTADO',     ct(estado, '')),
    ]

    n_rows = len(rows)
    row_h = box_h / n_rows
    label_w = box_w * 0.42
    text_h = min(row_h * 0.38, box_w * 0.018)

    # Marco exterior
    draw_rect(msp, box_x, box_y, box_w, box_h, layer=layer)

    for i, (label, value) in enumerate(rows):
        ry = box_y + box_h - (i + 1) * row_h
        # Línea divisoria horizontal
        if i > 0:
            draw_line(msp, box_x, ry + row_h, box_x + box_w, ry + row_h, layer=layer)
        # Separador etiqueta/valor
        draw_line(msp, box_x + label_w, ry, box_x + label_w, ry + row_h, layer=layer)
        # Textos
        mid_y = ry + row_h / 2.0
        draw_centered_text(msp, box_x + label_w / 2.0, mid_y - text_h * 0.5, text_h,
                           label, layer=text_layer, style=style)
        draw_left_text(msp, box_x + label_w + text_h * 0.4, mid_y - text_h * 0.5, text_h,
                       value, layer=text_layer, style=style)

    print(f"[DXF] Membrete profesional dibujado: {n_rows} filas en ({box_x:.1f},{box_y:.1f})", file=sys.stderr)


def draw_segment_ticks(msp, pts, geom_type, tick_size, layer='COTAS'):
    """
    Paso 9 — Dibuja ticks de 45° (estilo topográfico venezolano) en los extremos
    de cada segmento del polígono. Simula el estilo de plancheta catastral SUNAC.
    tick_size: tamaño del tick en unidades del plano.
    """
    n = len(pts)
    for i in range(n):
        is_last = (i == n - 1)
        if geom_type == 'abierta' and is_last:
            continue
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        dx = p2['x'] - p1['x']
        dy = p2['y'] - p1['y']
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue
        # Vector unitario del segmento
        ux, uy = dx / length, dy / length
        # Vector perpendicular (90° antihorario)
        px, py = -uy, ux
        # Tick de 45°: combinar dirección y perpendicular
        half = tick_size / 2.0
        for p_tick in (p1, p2):
            tx, ty = p_tick['x'], p_tick['y']
            # Marca de +45°: desde el punto, en dirección (ux+px, uy+py) normalizado
            d45x = (ux + px) / math.sqrt(2)
            d45y = (uy + py) / math.sqrt(2)
            msp.add_line(
                (tx - d45x * half, ty - d45y * half),
                (tx + d45x * half, ty + d45y * half),
                dxfattribs={'layer': layer}
            )


# ══════════════════════════════════════════════════════════════════════════════

def _extract_coords(pt):
    """Helper to extract X and Y from various payload formats."""
    x, y = None, None
    # Try direct keys
    for k_x in ('x', 'este', 'e'):
        if k_x in pt and pt[k_x] is not None:
            x = float(pt[k_x])
            break
    for k_y in ('y', 'norte', 'n'):
        if k_y in pt and pt[k_y] is not None:
            y = float(pt[k_y])
            break
    # Try 'result' wrapper
    if x is None or y is None:
        res = pt.get('result')
        if isinstance(res, dict):
            if x is None:
                for k_x in ('este', 'x', 'e'):
                    if k_x in res and res[k_x] is not None:
                        x = float(res[k_x])
                        break
            if y is None:
                for k_y in ('norte', 'y', 'n'):
                    if k_y in res and res[k_y] is not None:
                        y = float(res[k_y])
                        break
    return x, y

def main():
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({'status': 'error', 'message': 'No input data provided'}))
            sys.exit(1)
        data = json.loads(input_data)
        
        template_path = data.get('template_path')
        output_path = data.get('output_path')
        payload_input = data.get('payload')

        if not template_path or not output_path or not payload_input:
            print(json.dumps({'status': 'error', 'message': 'Missing required fields: template_path, output_path, or payload'}))
            sys.exit(1)
            
        payload = payload_input
    except Exception as e:
        print(json.dumps({'status': 'error', 'message': f'Invalid input: {str(e)}'}))
        sys.exit(1)
    
    # Extract required fields with defaults
    sat_img_path = None  # Assigned if satellite image is embedded
    metadata = payload.get('metadata', {})
    text_style = payload.get('textStyle', 'GEO_ARIAL')
    dxf_scale_factor = payload.get('dxfScaleFactor', 1.0)
    dxf_offset_x = payload.get('dxfOffsetX', 0)
    dxf_offset_y = payload.get('dxfOffsetY', 0)
    include_satellite = payload.get('includeSatellite')
    if include_satellite is None and isinstance(metadata, dict):
        include_satellite = metadata.get('includeSatellite', True)
    if include_satellite is None:
        include_satellite = True
    else:
        include_satellite = bool(include_satellite)

    # Crear documento DXF limpio R2010 desde cero para evitar objetos/diccionarios
    # huérfanos de plantillas antiguas que obligan a ejecutar AUDIT en AutoCAD.
    doc = ezdxf.new('R2010')
    doc.header['$INSUNITS'] = 6
    msp = doc.modelspace()
    has_template_blocks = False

    doc.header['$TEXTSTYLE'] = 'GEO_ARIAL'

    styles_to_register = [
        ('GEO_ARIAL', 'arial.ttf', True),
        ('GEO_SHX', 'simplex.shx', False),
    ]
    for style_name, font_name, is_tt in styles_to_register:
        if style_name in doc.styles:
            style = doc.styles.get(style_name)
        else:
            style = doc.styles.new(style_name)
        style.dxf.font = font_name
        style.dxf.height = 0.0
        style.dxf.width = 1.0
    
    common_styles = [
        ('STANDARD', 'arial.ttf', True),
        ('ROMANS', 'arial.ttf', True),
        ('SIMPLEX', 'arial.ttf', True),
    ]
    for style_name, font_name, is_tt in common_styles:
        if style_name not in doc.styles:
            doc.styles.new(style_name)
        style = doc.styles.get(style_name)
        style.dxf.font = font_name
        style.dxf.height = 0.0
        style.dxf.width = 1.0
    
    if 'MARCO' not in doc.layers:
        doc.layers.new('MARCO', dxfattribs={'color': 7})
    else:
        doc.layers.get('MARCO').dxf.color = 7
        
    if 'POLIGONO' not in doc.layers:
        doc.layers.new('POLIGONO', dxfattribs={'color': 10})
    else:
        doc.layers.get('POLIGONO').dxf.color = 10
        
    if 'TEXTOS' not in doc.layers:
        doc.layers.new('TEXTOS', dxfattribs={'color': 7})
    else:
        doc.layers.get('TEXTOS').dxf.color = 7
        
    if 'GRILLA' not in doc.layers:
        doc.layers.new('GRILLA', dxfattribs={'color': 8})
    else:
        doc.layers.get('GRILLA').dxf.color = 8
        
    validate_layers(doc)
        
    if 'COTAS' not in doc.layers:
        doc.layers.new('COTAS', dxfattribs={'color': 230})
    else:
        doc.layers.get('COTAS').dxf.color = 230

    if 'UBICACION' not in doc.layers:
        doc.layers.new('UBICACION', dxfattribs={'color': 4})  # Cian — capa plano de ubicación
    else:
        doc.layers.get('UBICACION').dxf.color = 4
    
    msp = doc.modelspace()

    # ── Parse Parcela(s) ──────────────────────────────────────────────────────
    raw_parcels = payload.get('parcels')
    if not raw_parcels or not isinstance(raw_parcels, list):
        pts_input = payload.get('points') or payload.get('puntos') or []
        raw_parcels = [{
            'nombre': metadata.get('projectName', 'PARCELA'),
            'puntos': pts_input,
            'area': metadata.get('areaDoc'),
            'geometryType': payload.get('geometryType') or metadata.get('geometryType', 'cerrada')
        }]

    processed_parcels = []
    all_raw_xs, all_raw_ys = [], []

    for p_idx, p_data in enumerate(raw_parcels):
        p_pts_raw = p_data.get('points') or p_data.get('puntos') or []
        p_name = clean_text(p_data.get('nombre') or f"PARCELA_{p_idx + 1}", f"PARCELA_{p_idx + 1}")
        p_geom_type = p_data.get('geometryType') or 'cerrada'
        
        parsed_pts = []
        for index, pt in enumerate(p_pts_raw):
            x_val, y_val = _extract_coords(pt)
            pt_id = pt.get('id', str(index + 1))
            if not pt_id:
                pt_id = str(index + 1)
            if x_val is not None and y_val is not None:
                parsed_pts.append({
                    'x': x_val,
                    'y': y_val,
                    'id': clean_text(pt_id, str(index + 1))
                })
        
        if not parsed_pts:
            continue

        raw_xs = [p['x'] for p in parsed_pts]
        raw_ys = [p['y'] for p in parsed_pts]
        all_raw_xs.extend(raw_xs)
        all_raw_ys.extend(raw_ys)

        scaled_pts = [
            {
                'x': (p['x'] + dxf_offset_x) * dxf_scale_factor,
                'y': (p['y'] + dxf_offset_y) * dxf_scale_factor,
                'id': p['id']
            } for p in parsed_pts
        ]

        if len(scaled_pts) >= (3 if p_geom_type == 'cerrada' else 2):
            geo = calculate_geometry(scaled_pts) if len(scaled_pts) >= 3 else {'area': 0.0, 'perim': 0.0, 'signedArea': 0.0}
            area_m = abs(geo['area'])
            perim_m = geo['perim']
            is_ccw = geo['signedArea'] > 0
            
            p_xs = [pt['x'] for pt in scaled_pts]
            p_ys = [pt['y'] for pt in scaled_pts]
            
            area_doc_val = float(p_data.get('area', area_m)) if p_data.get('area') else area_m

            processed_parcels.append({
                'nombre': p_name,
                'geometryType': p_geom_type,
                'pts': scaled_pts,
                'area_mensura': area_m,
                'area_doc': area_doc_val,
                'perim': perim_m,
                'is_ccw': is_ccw,
                'min_x': min(p_xs), 'max_x': max(p_xs),
                'min_y': min(p_ys), 'max_y': max(p_ys),
                'cx': (min(p_xs) + max(p_xs)) / 2.0,
                'cy': (min(p_ys) + max(p_ys)) / 2.0,
                'data_w': max(p_xs) - min(p_xs),
                'data_h': max(p_ys) - min(p_ys),
            })

    if not processed_parcels:
        raise ValueError("No se encontraron parcelas o vértices válidos para exportar.")

    if all_raw_xs and all_raw_ys:
        cx_raw = (min(all_raw_xs) + max(all_raw_xs)) / 2.0
        cy_raw = (min(all_raw_ys) + max(all_raw_ys)) / 2.0
    else:
        cx_raw, cy_raw = 0.0, 0.0

    # Global Bounding Box & Centroid across all parcels
    min_x = min(p['min_x'] for p in processed_parcels)
    max_x = max(p['max_x'] for p in processed_parcels)
    min_y = min(p['min_y'] for p in processed_parcels)
    max_y = max(p['max_y'] for p in processed_parcels)
    data_w = max_x - min_x
    data_h = max_y - min_y
    cx = (min_x + max_x) / 2.0
    cy = (min_y + max_y) / 2.0
    
    parsed_pts = processed_parcels[0]['pts']
    geometry_type = processed_parcels[0]['geometryType']

    raw_project_name = metadata.get('projectName', processed_parcels[0]['nombre'])
    decoded_name = urllib.parse.unquote(raw_project_name) if isinstance(raw_project_name, str) else raw_project_name
    project_name = clean_text(decoded_name, 'PARCELA') or decoded_name
    
    estado = clean_text(metadata.get('estado', 'S/D')).upper()
    municipio = clean_text(metadata.get('municipio', 'S/D')).upper()
    parroquia = clean_text(metadata.get('parroquia', 'S/D')).upper()
    propietario = clean_text(metadata.get('propietario', 'S/D')).upper()
    rif = clean_text(metadata.get('rif', 'S/D')).upper()
    domicilio = clean_text(metadata.get('domicilio', 'S/D')).upper()
    profesional = clean_text(metadata.get('profesional', 'ING. CATASTRAL / GEODESTA')).upper()
    civ = clean_text(metadata.get('civ', 'S/D')).upper()
    zona = clean_text(metadata.get('zona', 'S/D')).upper()
    seccion = clean_text(metadata.get('seccion', 'S/D')).upper()
    cedula_cat = clean_text(metadata.get('cedulaCat', 'S/D')).upper()
    observaciones = clean_text(metadata.get('observaciones', 'NINGUNA. MEDIDAS TOPOGRAFICAS DE ALTA PRECISION UTM REFERIDAS AL DATUM REGVEN.')).upper()
    
    # 1. Scaling Snap logic matching exportDxf.ts exactly
    padding = 1.35
    scale_w = (data_w * padding) / (0.420 * 0.51)
    scale_h = (data_h * padding) / (0.297 * 0.90)
    raw_scale = max(scale_w, scale_h, 250.0)
    
    power = 10.0 ** math.floor(math.log10(raw_scale))
    norm = raw_scale / power
    if norm <= 1.0:
        snap = 1.0
    elif norm <= 2.0:
        snap = 2.0
    elif norm <= 2.5:
        snap = 2.5
    elif norm <= 5.0:
        snap = 5.0
    else:
        snap = 10.0
    print_scale = snap * power
    
    sheet_w = 0.420 * print_scale
    sheet_h = 0.297 * print_scale
    margin = sheet_h * 0.02
    
    outer = {'x': 0.0, 'y': 0.0, 'w': sheet_w, 'h': sheet_h}
    inner = {'x': margin, 'y': margin, 'w': sheet_w - 2.0 * margin, 'h': sheet_h - 2.0 * margin}
    
    map_box = {'x': inner['x'], 'y': inner['y'], 'w': inner['w'] * 0.50, 'h': inner['h']}
    middle_box = {'x': map_box['x'] + map_box['w'], 'y': inner['y'], 'w': inner['w'] * 0.25, 'h': inner['h']}
    side_box = {'x': middle_box['x'] + middle_box['w'], 'y': inner['y'], 'w': inner['w'] * 0.25, 'h': inner['h']}
    
    plot_box = {
        'x': cx - (map_box['w'] / 2.0),
        'y': cy - (map_box['h'] / 2.0),
        'w': map_box['w'],
        'h': map_box['h']
    }
    
    sheet_offset = {
        'x': plot_box['x'] - map_box['x'],
        'y': plot_box['y'] - map_box['y']
    }
    
    outer['x'] += sheet_offset['x']; outer['y'] += sheet_offset['y']
    inner['x'] += sheet_offset['x']; inner['y'] += sheet_offset['y']
    map_box['x'] += sheet_offset['x']; map_box['y'] += sheet_offset['y']
    middle_box['x'] += sheet_offset['x']; middle_box['y'] += sheet_offset['y']
    side_box['x'] += sheet_offset['x']; side_box['y'] += sheet_offset['y']
    
    # Escalar y reposicionar dinámicamente las entidades de la capa NOTAS (logotipo y marca de agua)
    notas_matrix = (
        Matrix44.translate(sheet_offset['x'], sheet_offset['y'], 0.0)
        @ Matrix44.scale(print_scale, print_scale, 1.0)
    )
    for entity in list(msp):
        if entity.dxf.layer == 'NOTAS':
            try:
                entity.transform(notas_matrix)
            except Exception as e:
                print(f"Error transforming NOTAS entity {entity.dxftype()}: {e}", file=sys.stderr)
    
    frame_thickness = print_scale * 0.0004
    poly_thickness = print_scale * 0.0006
    # Alturas de texto basadas en print_scale (norma catastral SUNAC/IGVSB)
    # text_h ~3.0mm en papel, cota_base_h ~2.2mm en papel — Garantiza legibilidad total
    text_h = print_scale * 0.0030        # 3.0 mm papel — texto base
    cota_base_h = print_scale * 0.0022   # 2.2 mm papel — cotas y distancias
    
    # ================= 2. BORDERS (MARCO layer) ================= //
    draw_rect(msp, outer['x'], outer['y'], outer['w'], outer['h'], thickness=0.0, layer='MARCO')
    draw_rect(msp, inner['x'], inner['y'], inner['w'], inner['h'], thickness=frame_thickness, layer='MARCO')
    
    # Vertical dividers for tables
    draw_line(msp, middle_box['x'], inner['y'], middle_box['x'], inner['y'] + inner['h'], layer='MARCO')
    draw_line(msp, side_box['x'], inner['y'], side_box['x'], inner['y'] + inner['h'], layer='MARCO')
    
    # ================= 3. GRID (GRILLA layer) ================= //
    grid_step = nice_step(max(data_w, data_h))
    grid_start_x = math.ceil(plot_box['x'] / grid_step) * grid_step
    grid_start_y = math.ceil(plot_box['y'] / grid_step) * grid_step
    
    grid_dash_len = max(1.0, grid_step * 0.02)
    grid_gap_len = max(1.0, grid_step * 0.02)
    
    if 'GRILLA_PUNTEADA' not in doc.linetypes:
        doc.linetypes.add(
            name='GRILLA_PUNTEADA',
            pattern=[grid_dash_len + grid_gap_len, grid_dash_len, -grid_gap_len],
            description='Grilla Punteada Fina _ _ _ _'
        )
    
    if 'GRILLA' in doc.layers:
        try:
            doc.layers.get('GRILLA').dxf.linetype = 'GRILLA_PUNTEADA'
        except Exception as e:
            print(f"Error setting layer linetype: {e}", file=sys.stderr)
    
    # Grid Labels
    x_grid = grid_start_x
    while x_grid <= plot_box['x'] + plot_box['w']:
        draw_line(msp, x_grid, plot_box['y'], x_grid, plot_box['y'] + plot_box['h'], layer='GRILLA', linetype='GRILLA_PUNTEADA')
        txt = f"E {int(round(x_grid))}"
        txt_width = len(txt) * text_h * 0.65
        draw_left_text(msp, x_grid - text_h * 0.3, plot_box['y'] + txt_width + text_h, text_h, txt, rotation=90, layer='TEXTOS', style=text_style)
        x_grid += grid_step
        
    y_grid = grid_start_y
    while y_grid <= plot_box['y'] + plot_box['h']:
        draw_line(msp, plot_box['x'], y_grid, plot_box['x'] + plot_box['w'], y_grid, layer='GRILLA', linetype='GRILLA_PUNTEADA')
        txt = f"N {int(round(y_grid))}"
        draw_left_text(msp, plot_box['x'] + text_h * 0.5, y_grid + text_h * 0.3, text_h, txt, rotation=0, layer='TEXTOS', style=text_style)
        y_grid += grid_step
        
    # ================= 4. POLYGONS & ANNOTATIONS FOR ALL PARCELS ================= //
    for p_item in processed_parcels:
        p_pts = p_item['pts']
        p_geom_type = p_item['geometryType']
        p_name = p_item['nombre']
        p_cx, p_cy = p_item['cx'], p_item['cy']
        p_perim = p_item['perim']
        p_is_ccw = p_item['is_ccw']
        
        avg_edge_len = p_perim / max(len(p_pts), 1)
        min_edge_len = float('inf')
        for i in range(len(p_pts)):
            p_curr = p_pts[i]
            p_next = p_pts[(i + 1) % len(p_pts)]
            edge_len = math.hypot(p_next['x'] - p_curr['x'], p_next['y'] - p_curr['y'])
            if edge_len < min_edge_len:
                min_edge_len = edge_len
        if min_edge_len == float('inf') or min_edge_len <= 0:
            min_edge_len = avg_edge_len

        # ─ Escalado de texto de vértices y cotas — Norma catastral VEN (Pisos de legibilidad) ─
        # ID de vértice: mínimo 2.5 mm en papel para evitar micro-textos illegibles
        v_id_h = max(
            print_scale * 0.0025,  # Piso firme 2.5 mm en papel
            min(min_edge_len * 0.20, avg_edge_len * 0.15, print_scale * 0.0035)
        )
        # Cota (distancia de lado): mínimo 2.2 mm en papel
        v_dist_h = max(
            print_scale * 0.0022,  # Piso firme 2.2 mm en papel
            min(avg_edge_len * 0.12, v_id_h * 0.90)
        )
        marker_radius = v_id_h * 0.25
        cota_offset_factor = 1.8

        if p_geom_type != 'puntos':
            vertices = [(pt['x'], pt['y']) for pt in p_pts]
            msp.add_lwpolyline(vertices, close=(p_geom_type == 'cerrada'), dxfattribs={'layer': 'POLIGONO', 'const_width': poly_thickness})
            # Ticks de cota a 45° en extremos de cada segmento
            tick_size = v_id_h * 1.2
            draw_segment_ticks(msp, p_pts, p_geom_type, tick_size)

        for i, pt in enumerate(p_pts):
            is_last_edge = (i == len(p_pts) - 1)
            is_valid_segment = (p_geom_type == 'cerrada') or (p_geom_type == 'abierta' and not is_last_edge)

            p_next = p_pts[(i + 1) % len(p_pts)]
            edge_len = math.hypot(p_next['x'] - pt['x'], p_next['y'] - pt['y'])

            dx = p_next['x'] - pt['x']
            dy = p_next['y'] - pt['y']
            length = math.hypot(dx, dy)

            if is_valid_segment and length > 0:
                edge_cota_h = max(print_scale * 0.0020, min(edge_len * 0.12, v_dist_h))

                if p_is_ccw:
                    nx = dy / length
                    ny = -dx / length
                else:
                    nx = -dy / length
                    ny = dx / length

                dist_offset = edge_cota_h * cota_offset_factor
                mid_x = (pt['x'] + p_next['x']) / 2
                mid_y = (pt['y'] + p_next['y']) / 2

                txt_x = mid_x + nx * dist_offset
                txt_y = mid_y + ny * dist_offset

                cota_txt = f"{format_number(edge_len, 2)}"

                text_rot = math.degrees(math.atan2(dy, dx))
                if text_rot > 90: text_rot -= 180
                elif text_rot < -90: text_rot += 180

                draw_centered_text(msp, txt_x, txt_y, edge_cota_h, cota_txt,
                                   rotation=text_rot, layer='COTAS', style=text_style)

                # ID del vértice
                id_offset = marker_radius * 4.5
                lx = pt['x'] + nx * id_offset
                ly = pt['y'] + ny * id_offset
                draw_centered_text(msp, lx, ly + v_id_h * 0.3, v_id_h,
                                   pt['id'], layer='TEXTOS', style=text_style)
            else:
                draw_centered_text(msp, pt['x'], pt['y'] + marker_radius * 2.0,
                                   v_id_h, pt['id'], layer='TEXTOS', style=text_style)

            draw_circle(msp, pt['x'], pt['y'], marker_radius, layer='TEXTOS')

        # ─ Texto interior de parcela (Únicamente Nombre/Identificador de parcela) ─────
        inner_dim = min(p_item['data_w'], p_item['data_h'])
        interior_text_h = max(
            print_scale * 0.0030,  # Piso de 3.0 mm en papel para visibilidad óptima
            min(inner_dim * 0.045, print_scale * 0.0050)
        )
        draw_centered_text(msp, p_cx, p_cy, interior_text_h,
                           p_name, layer='TEXTOS', style=text_style)
    
    # ================= 5. MIDDLE COLUMN (CATASTRAL TABLES: BALANCE, PUNTO DE APOYO, RUMBOS, COORDENADAS) ================= //
    table_unit = inner['h'] / 100.0
    t_y = inner['y'] + inner['h'] - table_unit * 1.5

    box_x = middle_box['x'] + margin
    box_w = middle_box['w'] - 2.0 * margin

    for p_idx, p_item in enumerate(processed_parcels):
        p_pts = p_item['pts']
        p_name = p_item['nombre']
        p_geom_type = p_item['geometryType']
        p_area_m = p_item['area_mensura']
        p_area_doc = p_item['area_doc']

        # Extraer o calcular punto de apoyo (V.P.)
        pa_custom = payload.get('puntoApoyo') or metadata.get('puntoApoyo') or p_item.get('puntoApoyo')
        if isinstance(pa_custom, dict):
            pa_id = clean_text(pa_custom.get('id', 'V.P.'), 'V.P.')
            pa_x_val, pa_y_val = _extract_coords(pa_custom)
            pa_x = (pa_x_val if pa_x_val is not None else p_pts[0]['x'])
            pa_y = (pa_y_val if pa_y_val is not None else p_pts[0]['y'])
        else:
            pa_id = 'V.P.'
            pa_x = p_pts[0]['x']
            pa_y = p_pts[0]['y']

        # Calcular número de segmentos para tabla de rumbos
        n_pts = len(p_pts)
        n_segments = n_pts if p_geom_type == 'cerrada' else max(1, n_pts - 1)

        # Cálculo dinámico de alturas para ajustar exactamente al alto de middle_box con legibilidad optimizada
        total_items_count = 2 + 1 + n_segments + n_pts  # balance(2) + pa(1) + rumbos(n_seg) + coords(n_pts)
        total_headers_count = 4  # 4 tablas con encabezados
        avail_h = (t_y - (inner['y'] + margin))
        row_h = max(table_unit * 1.8, min(table_unit * 2.8, (avail_h * 0.72) / max(total_items_count, 1)))
        hdr_h = max(table_unit * 2.2, min(table_unit * 3.2, (avail_h * 0.25) / max(total_headers_count, 1)))
        gap_h = table_unit * 0.9

        # Formatos de área para Balance de Superficie (solo m2, sin hectáreas)
        area_doc_txt = f"{format_number(p_area_doc, 2)} m2"
        area_mens_txt = f"{format_number(p_area_m, 2)} m2"

        # -------------------------------------------------------------
        # 5.1 TABLA DE BALANCE DE SUPERFICIE
        # -------------------------------------------------------------
        bal_rows = 2
        bal_h = hdr_h + bal_rows * row_h
        draw_rect(msp, box_x, t_y - bal_h, box_w, bal_h, thickness=frame_thickness * 0.5, layer='MARCO')
        draw_line(msp, box_x, t_y - hdr_h, box_x + box_w, t_y - hdr_h, layer='MARCO')
        draw_centered_text(msp, box_x + box_w / 2.0, t_y - hdr_h * 0.5, min(text_h * 0.90, hdr_h * 0.50),
                           'BALANCE DE SUPERFICIE', layer='TEXTOS', style=text_style)

        # División vertical etiquetas / valores
        bal_c1 = box_w * 0.58
        draw_line(msp, box_x + bal_c1, t_y - hdr_h, box_x + bal_c1, t_y - bal_h, layer='MARCO')
        draw_line(msp, box_x, t_y - hdr_h - row_h, box_x + box_w, t_y - hdr_h - row_h, layer='MARCO')

        bal_txt_h = max(print_scale * 0.0035, min(text_h * 0.92, row_h * 0.68))  # valores numéricos
        bal_lbl_h  = max(print_scale * 0.0018, min(text_h * 0.55, row_h * 0.44))  # etiquetas descriptivas
        y1_mid = t_y - hdr_h - row_h * 0.5
        draw_left_text(msp, box_x + text_h * 0.3, y1_mid, bal_lbl_h, 'AREA SEGUN DOCUMENTO', layer='TEXTOS', style=text_style)
        draw_centered_text(msp, box_x + bal_c1 + (box_w - bal_c1) / 2.0, y1_mid, bal_txt_h, area_doc_txt, layer='TEXTOS', style=text_style)

        y2_mid = t_y - hdr_h - row_h * 1.5
        draw_left_text(msp, box_x + text_h * 0.3, y2_mid, bal_lbl_h, 'AREA SEGUN MENSURA', layer='TEXTOS', style=text_style)
        draw_centered_text(msp, box_x + bal_c1 + (box_w - bal_c1) / 2.0, y2_mid, bal_txt_h, area_mens_txt, layer='TEXTOS', style=text_style)

        t_y -= bal_h + gap_h

        # -------------------------------------------------------------
        # 5.2 TABLA DE PUNTO DE APOYO (RED GEODÉSICA)
        # -------------------------------------------------------------
        pa_subhdr_h = hdr_h * 0.85
        pa_colhdr_h = hdr_h * 0.85
        pa_rows = 1
        pa_h = hdr_h + pa_subhdr_h + pa_colhdr_h + pa_rows * row_h
        draw_rect(msp, box_x, t_y - pa_h, box_w, pa_h, thickness=frame_thickness * 0.5, layer='MARCO')

        # Líneas de encabezados
        draw_line(msp, box_x, t_y - hdr_h, box_x + box_w, t_y - hdr_h, layer='MARCO')
        draw_line(msp, box_x, t_y - hdr_h - pa_subhdr_h, box_x + box_w, t_y - hdr_h - pa_subhdr_h, layer='MARCO')
        draw_line(msp, box_x, t_y - hdr_h - pa_subhdr_h - pa_colhdr_h, box_x + box_w, t_y - hdr_h - pa_subhdr_h - pa_colhdr_h, layer='MARCO')

        draw_centered_text(msp, box_x + box_w / 2.0, t_y - hdr_h * 0.5, min(text_h * 0.88, hdr_h * 0.48),
                           'PUNTO DE APOYO (RED GEODESICA)', layer='TEXTOS', style=text_style)
        draw_centered_text(msp, box_x + box_w / 2.0, t_y - hdr_h - pa_subhdr_h * 0.5, min(text_h * 0.80, pa_subhdr_h * 0.48),
                           'COORDENADAS REGVEN (UTM)', layer='TEXTOS', style=text_style)

        # Columnas PUNTO | NORTE | ESTE
        pa_c1 = box_w * 0.20
        pa_c2 = box_w * 0.40
        pa_c3 = box_w * 0.40
        draw_line(msp, box_x + pa_c1, t_y - hdr_h - pa_subhdr_h, box_x + pa_c1, t_y - pa_h, layer='MARCO')
        draw_line(msp, box_x + pa_c1 + pa_c2, t_y - hdr_h - pa_subhdr_h, box_x + pa_c1 + pa_c2, t_y - pa_h, layer='MARCO')

        pa_col_y = t_y - hdr_h - pa_subhdr_h - pa_colhdr_h * 0.5
        draw_cell_text(msp, box_x + pa_c1 * 0.5, pa_col_y, min(text_h * 0.78, pa_colhdr_h * 0.48), 'PUNTO', layer='TEXTOS', style=text_style)
        draw_cell_text(msp, box_x + pa_c1 + pa_c2 * 0.5, pa_col_y, min(text_h * 0.78, pa_colhdr_h * 0.48), 'NORTE', layer='TEXTOS', style=text_style)
        draw_cell_text(msp, box_x + pa_c1 + pa_c2 + pa_c3 * 0.5, pa_col_y, min(text_h * 0.78, pa_colhdr_h * 0.48), 'ESTE', layer='TEXTOS', style=text_style)

        pa_row_y = t_y - hdr_h - pa_subhdr_h - pa_colhdr_h - row_h * 0.5
        pa_val_txt_h = max(print_scale * 0.0035, min(text_h * 0.92, row_h * 0.68))
        draw_cell_text(msp, box_x + pa_c1 * 0.5, pa_row_y, pa_val_txt_h, pa_id, layer='TEXTOS', style=text_style)
        draw_cell_text(msp, box_x + pa_c1 + pa_c2 * 0.5, pa_row_y, pa_val_txt_h, format_number(pa_y, 3), layer='TEXTOS', style=text_style)
        draw_cell_text(msp, box_x + pa_c1 + pa_c2 + pa_c3 * 0.5, pa_row_y, pa_val_txt_h, format_number(pa_x, 3), layer='TEXTOS', style=text_style)

        t_y -= pa_h + gap_h

        # -------------------------------------------------------------
        # 5.3 CUADRO DE RUMBOS Y DISTANCIAS
        # -------------------------------------------------------------
        rb_hdr_h = hdr_h
        rb_colhdr_h = hdr_h * 0.85
        rb_rows = n_segments
        rb_h = rb_hdr_h + rb_colhdr_h + rb_rows * row_h
        draw_rect(msp, box_x, t_y - rb_h, box_w, rb_h, thickness=frame_thickness * 0.5, layer='MARCO')

        # Líneas de encabezados
        draw_line(msp, box_x, t_y - rb_hdr_h, box_x + box_w, t_y - rb_hdr_h, layer='MARCO')
        draw_line(msp, box_x, t_y - rb_hdr_h - rb_colhdr_h, box_x + box_w, t_y - rb_hdr_h - rb_colhdr_h, layer='MARCO')

        # Columnas: LADO (EST | PV) | RUMBO | DISTANCIA
        r_c_est = box_w * 0.12
        r_c_pv  = box_w * 0.12
        r_c_lado = r_c_est + r_c_pv
        r_c_rumbo = box_w * 0.48
        r_c_dist  = box_w - r_c_lado - r_c_rumbo

        # Línea vertical entre LADO y RUMBO
        draw_line(msp, box_x + r_c_lado, t_y, box_x + r_c_lado, t_y - rb_h, layer='MARCO')
        # Línea vertical entre RUMBO y DISTANCIA
        draw_line(msp, box_x + r_c_lado + r_c_rumbo, t_y, box_x + r_c_lado + r_c_rumbo, t_y - rb_h, layer='MARCO')
        # Línea vertical interna entre EST y PV
        draw_line(msp, box_x + r_c_est, t_y - rb_hdr_h, box_x + r_c_est, t_y - rb_h, layer='MARCO')

        # Textos de encabezados principales
        draw_centered_text(msp, box_x + r_c_lado * 0.5, t_y - rb_hdr_h * 0.5, min(text_h * 0.88, rb_hdr_h * 0.50), 'LADO', layer='TEXTOS', style=text_style)
        draw_centered_text(msp, box_x + r_c_lado + r_c_rumbo * 0.5, t_y - rb_hdr_h * 0.5, min(text_h * 0.88, rb_hdr_h * 0.50), 'RUMBO', layer='TEXTOS', style=text_style)
        draw_centered_text(msp, box_x + r_c_lado + r_c_rumbo + r_c_dist * 0.5, t_y - rb_hdr_h * 0.5, min(text_h * 0.80, rb_hdr_h * 0.48), 'DISTANCIA', layer='TEXTOS', style=text_style)

        # Sub-encabezados EST y PV
        rb_sub_y = t_y - rb_hdr_h - rb_colhdr_h * 0.5
        draw_cell_text(msp, box_x + r_c_est * 0.5, rb_sub_y, min(text_h * 0.78, rb_colhdr_h * 0.48), 'EST', layer='TEXTOS', style=text_style)
        draw_cell_text(msp, box_x + r_c_est + r_c_pv * 0.5, rb_sub_y, min(text_h * 0.78, rb_colhdr_h * 0.48), 'PV', layer='TEXTOS', style=text_style)
        draw_cell_text(msp, box_x + r_c_lado + r_c_rumbo * 0.5, rb_sub_y, min(text_h * 0.72, rb_colhdr_h * 0.45), '(GEODESICO)', layer='TEXTOS', style=text_style)
        draw_cell_text(msp, box_x + r_c_lado + r_c_rumbo + r_c_dist * 0.5, rb_sub_y, min(text_h * 0.72, rb_colhdr_h * 0.45), '(m)', layer='TEXTOS', style=text_style)

        for s_idx in range(n_segments):
            p1 = p_pts[s_idx]
            p2 = p_pts[(s_idx + 1) % n_pts]
            dx = p2['x'] - p1['x']
            dy = p2['y'] - p1['y']
            edge_dist = math.hypot(dx, dy)
            bearing_str = get_bearing(dx, dy)

            y_top = t_y - rb_hdr_h - rb_colhdr_h - s_idx * row_h
            y_mid = y_top - row_h * 0.5
            rb_txt_h = max(print_scale * 0.0035, min(text_h * 0.92, row_h * 0.68))

            if s_idx > 0:
                draw_line(msp, box_x, y_top, box_x + box_w, y_top, layer='MARCO')

            draw_cell_text(msp, box_x + r_c_est * 0.5, y_mid, rb_txt_h, str(p1['id']), layer='TEXTOS', style=text_style)
            draw_cell_text(msp, box_x + r_c_est + r_c_pv * 0.5, y_mid, rb_txt_h, str(p2['id']), layer='TEXTOS', style=text_style)
            draw_cell_text(msp, box_x + r_c_lado + r_c_rumbo * 0.5, y_mid, rb_txt_h, bearing_str, layer='TEXTOS', style=text_style)
            draw_cell_text(msp, box_x + r_c_lado + r_c_rumbo + r_c_dist * 0.5, y_mid, rb_txt_h, format_number(edge_dist, 2), layer='TEXTOS', style=text_style)

        t_y -= rb_h + gap_h

        # -------------------------------------------------------------
        # 5.4 TABLA DE COORDENADAS REGVEN (U.T.M)
        # -------------------------------------------------------------
        coo_hdr_h = hdr_h
        coo_colhdr_h = hdr_h * 0.85
        coo_rows = n_pts
        coo_h = coo_hdr_h + coo_colhdr_h + coo_rows * row_h

        draw_rect(msp, box_x, t_y - coo_h, box_w, coo_h, thickness=frame_thickness * 0.5, layer='MARCO')
        draw_line(msp, box_x, t_y - coo_hdr_h, box_x + box_w, t_y - coo_hdr_h, layer='MARCO')
        draw_line(msp, box_x, t_y - coo_hdr_h - coo_colhdr_h, box_x + box_w, t_y - coo_hdr_h - coo_colhdr_h, layer='MARCO')

        draw_centered_text(msp, box_x + box_w / 2.0, t_y - coo_hdr_h * 0.5, min(text_h * 0.88, coo_hdr_h * 0.50),
                           'COORDENADAS (U.T.M)', layer='TEXTOS', style=text_style)

        c_c1 = box_w * 0.20
        c_c2 = box_w * 0.40
        c_c3 = box_w * 0.40

        draw_line(msp, box_x + c_c1, t_y - coo_hdr_h, box_x + c_c1, t_y - coo_h, layer='MARCO')
        draw_line(msp, box_x + c_c1 + c_c2, t_y - coo_hdr_h, box_x + c_c1 + c_c2, t_y - coo_h, layer='MARCO')

        coo_col_y = t_y - coo_hdr_h - coo_colhdr_h * 0.5
        draw_cell_text(msp, box_x + c_c1 * 0.5, coo_col_y, min(text_h * 0.78, coo_colhdr_h * 0.48), 'PUNTO', layer='TEXTOS', style=text_style)
        draw_cell_text(msp, box_x + c_c1 + c_c2 * 0.5, coo_col_y, min(text_h * 0.78, coo_colhdr_h * 0.48), 'NORTE', layer='TEXTOS', style=text_style)
        draw_cell_text(msp, box_x + c_c1 + c_c2 + c_c3 * 0.5, coo_col_y, min(text_h * 0.78, coo_colhdr_h * 0.48), 'ESTE', layer='TEXTOS', style=text_style)

        for idx, pt in enumerate(p_pts):
            y_top = t_y - coo_hdr_h - coo_colhdr_h - idx * row_h
            coord_text_h = max(print_scale * 0.0038, min(text_h * 0.95, row_h * 0.72))
            y_center = y_top - row_h / 2.0

            if idx > 0:
                draw_line(msp, box_x, y_top, box_x + box_w, y_top, layer='MARCO')

            draw_cell_text(msp, box_x + c_c1 * 0.5, y_center,
                           coord_text_h, str(pt['id']), layer='TEXTOS', style=text_style)
            draw_cell_text(msp, box_x + c_c1 + c_c2 * 0.5, y_center,
                           coord_text_h, format_number(pt['y'], 3), layer='TEXTOS', style=text_style)
            draw_cell_text(msp, box_x + c_c1 + c_c2 + c_c3 * 0.5, y_center,
                           coord_text_h, format_number(pt['x'], 3), layer='TEXTOS', style=text_style)

        t_y -= coo_h + gap_h

    # ================= 6. TITLE BLOCK COLUMN (SIDE) ================= //
    s_unit = inner['h'] / 75.0
    s_y = inner['y'] + inner['h']

    # 6.1 Mensura Header (6 units)
    s_y -= s_unit * 6.0
    draw_line(msp, side_box['x'], s_y, side_box['x'] + side_box['w'], s_y, layer='MARCO')
    draw_centered_text(msp, side_box['x'] + side_box['w'] / 2.0, s_y + s_unit * 4.5, text_h * 1.0, 'MENSURA DE TERRENO', layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.1, s_y + s_unit * 3.0, text_h * 0.8, f"ESTADO: {estado}", layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.1, s_y + s_unit * 1.8, text_h * 0.8, f"MUNICIPIO: {municipio}", layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.1, s_y + s_unit * 0.6, text_h * 0.8, f"PARROQUIA: {parroquia}", layer='TEXTOS', style=text_style)
    
    # 6.2 Amparada (8 units)
    s_y -= s_unit * 8.0
    draw_line(msp, side_box['x'], s_y, side_box['x'] + side_box['w'], s_y, layer='MARCO')
    draw_centered_text(msp, side_box['x'] + side_box['w'] / 2.0, s_y + s_unit * 6.5, text_h * 0.8, 'AMPARADA POR EL DOCUMENTO', layer='TEXTOS', style=text_style)
    reg_text = f"OFICINA SUBALTERNA DE REGISTRO DE LOS MUNICIPIOS {municipio.upper()} Y LOS TAQUES DEL ESTADO {estado.upper()}," if estado.upper() == 'FALCON' else f"OFICINA SUBALTERNA DE REGISTRO DE EL ESTADO {estado.upper()},"
    reg_text += " BAJO EL NRO. ____, FOLIOS ____ AL ___, PROTOCOLO: ________ TRIMESTRE ______, Año: ________"
    
    reg_words = reg_text.split()
    reg_lines = []
    curr_line = ""
    for w in reg_words:
        if len(curr_line) + len(w) + 1 < 36:
            curr_line += (" " if curr_line else "") + w
        else:
            reg_lines.append(curr_line)
            curr_line = w
    if curr_line:
        reg_lines.append(curr_line)
        
    for r_idx, r_line in enumerate(reg_lines[:4]):
        draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 5.0 - r_idx * text_h * 1.25, text_h * 0.55, r_line, layer='TEXTOS', style=text_style)
    
    # 6.3 Antecedentes (12 units)
    s_y -= s_unit * 12.0
    draw_line(msp, side_box['x'], s_y, side_box['x'] + side_box['w'], s_y, layer='MARCO')
    draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 10.5, text_h * 0.8, 'ANTECEDENTES Y OBSERVACIONES', layer='TEXTOS', style=text_style)
    
    obs_words = observaciones.split()
    obs_lines = []
    curr_line = ""
    for w in obs_words:
        if len(curr_line) + len(w) + 1 < 32:
            curr_line += (" " if curr_line else "") + w
        else:
            obs_lines.append(curr_line)
            curr_line = w
    if curr_line:
        obs_lines.append(curr_line)
        
    for o_idx, o_line in enumerate(obs_lines[:6]):
        draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 8.5 - o_idx * text_h * 1.3, text_h * 0.6, o_line, layer='TEXTOS', style=text_style)
        
    # 6.4 Plano de Ubicación Local (20 units) — Croquis Vectorial Oficial
    s_y -= s_unit * 20.0
    draw_line(msp, side_box['x'], s_y, side_box['x'] + side_box['w'], s_y, layer='MARCO')
    draw_line(msp, side_box['x'] + side_box['w'] * 0.6, s_y + s_unit * 20.0, side_box['x'] + side_box['w'] * 0.6, s_y, layer='MARCO')
    draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 18.5, text_h * 0.8, 'PLANO DE UBICACIÓN LOCAL:', layer='TEXTOS', style=text_style)

    croq_box = {
        'x': side_box['x'] + margin,
        'y': s_y + margin,
        'w': side_box['w'] * 0.6 - margin * 2.0,
        'h': s_unit * 17.0
    }

    pad_x = croq_box['w'] * 0.02
    pad_y = croq_box['h'] * 0.02
    disp_w = croq_box['w'] - 2.0 * pad_x
    disp_h = croq_box['h'] - 2.0 * pad_y
    ins_x  = croq_box['x'] + pad_x
    ins_y  = croq_box['y'] + pad_y

    croq_scale_val = 5000.0
    mini_scale = print_scale / croq_scale_val
    max_croq_w = croq_box['w'] * 0.8; max_croq_h = croq_box['h'] * 0.7
    if data_w * mini_scale > max_croq_w or data_h * mini_scale > max_croq_h:
        req_s = max((data_w*print_scale)/max_croq_w, (data_h*print_scale)/max_croq_h)
        pwr = 10.0 ** math.floor(math.log10(req_s))
        nrm = req_s / pwr
        cs = 1.0 if nrm<=1 else 2.0 if nrm<=2 else 2.5 if nrm<=2.5 else 5.0 if nrm<=5 else 10.0
        croq_scale_val = max(5000.0, cs * pwr)
        mini_scale = print_scale / croq_scale_val

    croq_cx = ins_x + disp_w / 2.0
    croq_cy = ins_y + disp_h / 2.0

    for croq_item in processed_parcels:
        croq_pts = croq_item['pts']
        croq_verts = [
            (croq_cx + (p['x'] - cx) * mini_scale, croq_cy + (p['y'] - cy) * mini_scale)
            for p in croq_pts
        ]
        msp.add_lwpolyline(
            croq_verts, close=(croq_item['geometryType'] == 'cerrada'),
            dxfattribs={'layer': 'UBICACION', 'const_width': poly_thickness * 0.8}
        )
        for vp in croq_verts:
            draw_circle(msp, vp[0], vp[1], text_h * 0.4, layer='UBICACION')

    draw_line(msp, croq_cx - text_h * 2.5, croq_cy, croq_cx + text_h * 2.5, croq_cy, layer='GRILLA')
    draw_line(msp, croq_cx, croq_cy - text_h * 2.5, croq_cx, croq_cy + text_h * 2.5, layer='GRILLA')

    draw_centered_text(msp, croq_cx, s_y + s_unit * 17.0, text_h * 0.85, 'CROQUIS DE UBICACION', layer='TEXTOS', style=text_style)
    draw_centered_text(msp, croq_cx, s_y + s_unit * 15.5, text_h * 0.70, f"ESC. 1:{int(croq_scale_val)}", layer='TEXTOS', style=text_style)
    
    draw_line(msp, side_box['x'] + side_box['w'] * 0.6, s_y + s_unit * 17.0, side_box['x'] + side_box['w'], s_y + s_unit * 17.0, layer='MARCO')
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 18.0 - text_h * 0.35, text_h * 0.75, 'ZONIFICACIÓN', layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 15.0 - text_h * 0.35, text_h * 0.65, f"ZONA: {zona}", layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 13.5 - text_h * 0.35, text_h * 0.65, f"SECCIÓN: {seccion}", layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 12.0 - text_h * 0.35, text_h * 0.65, f"CATASTRAL: {cedula_cat}", layer='TEXTOS', style=text_style)
    
    draw_compass_rose(msp, side_box['x'] + side_box['w'] * 0.8, s_y + s_unit * 6.0, text_h * 2.5, doc=doc, has_template_blocks=has_template_blocks, style=text_style)
    
    # 6.5 Propietario / Dirección (9 units)
    s_y -= s_unit * 9.0
    draw_line(msp, side_box['x'], s_y, side_box['x'] + side_box['w'], s_y, layer='MARCO')
    draw_line(msp, side_box['x'] + side_box['w'] * 0.6, s_y + s_unit * 9.0, side_box['x'] + side_box['w'] * 0.6, s_y, layer='MARCO')
    
    draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 7.5, text_h * 0.8, 'PROPIETARIO:', layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 5.0, text_h * 0.75, propietario[:30], layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 1.5, text_h * 0.7, f"C.I / RIF: {rif}", layer='TEXTOS', style=text_style)
    
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 7.5, text_h * 0.8, 'DOMICILIO:', layer='TEXTOS', style=text_style)
    dom_lines = []
    curr_dom = ""
    for w in domicilio.split():
        if len(curr_dom) + len(w) + 1 < 16:
            curr_dom += (" " if curr_dom else "") + w
        else:
            dom_lines.append(curr_dom)
            curr_dom = w
    if curr_dom:
        dom_lines.append(curr_dom)
    for d_idx, d_line in enumerate(dom_lines[:3]):
        draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 5.5 - d_idx * text_h * 1.2, text_h * 0.6, d_line, layer='TEXTOS', style=text_style)
        
    # 6.6 Profesional (8 units)
    s_y -= s_unit * 8.0
    draw_line(msp, side_box['x'], s_y, side_box['x'] + side_box['w'], s_y, layer='MARCO')
    draw_line(msp, side_box['x'] + side_box['w'] * 0.6, s_y + s_unit * 8.0, side_box['x'] + side_box['w'] * 0.6, s_y, layer='MARCO')
    
    draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 6.5, text_h * 0.8, 'FECHA DE MENSURA', layer='TEXTOS', style=text_style)
    date_str = metadata.get('fecha', datetime.date.today().strftime('%d/%m/%Y'))
    draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 4.5, text_h * 0.8, date_str, layer='TEXTOS', style=text_style)
    
    draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 2.5, text_h * 0.8, 'ESCALA', layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 1.0, text_h * 0.8, f"1:{int(print_scale)}", layer='TEXTOS', style=text_style)
    
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 6.5, text_h * 0.8, 'PROFESIONAL', layer='TEXTOS', style=text_style)
    prof_lines = []
    curr_prof = ""
    for w in profesional.split():
        if len(curr_prof) + len(w) + 1 < 16:
            curr_prof += (" " if curr_prof else "") + w
        else:
            prof_lines.append(curr_prof)
            curr_prof = w
    if curr_prof:
        prof_lines.append(curr_prof)
    for p_idx, p_line in enumerate(prof_lines[:2]):
        draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 4.8 - p_idx * text_h * 1.2, text_h * 0.7, p_line, layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 1.5, text_h * 0.7, f"REG: {civ}", layer='TEXTOS', style=text_style)
    
    # 6.7 Firmas (6 units)
    s_y -= s_unit * 6.0
    draw_line(msp, side_box['x'], s_y, side_box['x'] + side_box['w'], s_y, layer='MARCO')
    draw_line(msp, side_box['x'] + side_box['w'] * 0.6, s_y + s_unit * 6.0, side_box['x'] + side_box['w'] * 0.6, s_y, layer='MARCO')
    
    draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 4.5, text_h * 0.8, 'REVISADO', layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 4.5, text_h * 0.8, 'LEVANTAMIENTO', layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 1.0, text_h * 0.7, 'FIRMA:', layer='TEXTOS', style=text_style)
    
    # 6.8 Registrado (6 units)
    s_y -= s_unit * 6.0
    draw_line(msp, side_box['x'], s_y, side_box['x'] + side_box['w'], s_y, layer='MARCO')
    draw_line(msp, side_box['x'] + side_box['w'] * 0.6, s_y + s_unit * 6.0, side_box['x'] + side_box['w'] * 0.6, s_y, layer='MARCO')
    
    draw_left_text(msp, side_box['x'] + margin * 0.5, s_y + s_unit * 4.5, text_h * 0.8, 'REGISTRADO', layer='TEXTOS', style=text_style)
    draw_centered_text(msp, side_box['x'] + side_box['w'] * 0.3, s_y + s_unit * 1.5, text_h * 0.8, 'JEFE DE CATASTRO', layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 4.5, text_h * 0.8, 'DIGITALIZACION', layer='TEXTOS', style=text_style)
    draw_left_text(msp, side_box['x'] + side_box['w'] * 0.62, s_y + s_unit * 1.0, text_h * 0.7, 'FIRMA:', layer='TEXTOS', style=text_style)

    # ── Membrete Oficial en Espacio Restante ───────────────────────────────
    membrete_h = s_y - inner['y'] - margin
    if membrete_h > text_h * 4.0:
        fecha_str = metadata.get('fecha', datetime.date.today().strftime('%d/%m/%Y'))
        draw_membrete(
            msp,
            box_x=side_box['x'],
            box_y=inner['y'] + margin,
            box_w=side_box['w'],
            box_h=membrete_h,
            metadata=metadata,
            print_scale=print_scale,
            fecha=fecha_str,
            layer='MARCO',
            text_layer='TEXTOS',
            style=text_style
        )

    # ================= 7. PROJECT INFO BOX (CUADRO DE DATOS Y ESCALA) ================= //
    # Ubicado estrictamente en la esquina inferior izquierda del viewport del mapa (map_box)
    box_w = min(map_box['w'] * 0.52, text_h * 25.0)
    box_h = text_h * 8.5
    
    box_x = map_box['x'] + margin
    box_y = map_box['y'] + margin
    
    draw_rect(msp, box_x, box_y, box_w, box_h, thickness=poly_thickness * 0.6, layer='MARCO')
    
    total_area_mensura = sum(p['area_mensura'] for p in processed_parcels)
    total_area_ha = total_area_mensura / 10000.0
    total_perim = sum(p['perim'] for p in processed_parcels)
    
    epsg_code = payload.get('epsg') or metadata.get('epsg') or detect_epsg_regven(cx_raw)
    zona_utm = "19N" if epsg_code == 2201 else "20N" if epsg_code == 2202 else "21N"
    datum_str = f"REGVEN (SIRGAS) / UTM ZONA {zona_utm}"

    if total_area_mensura >= 10000.0:
        area_total_str = f"AREA TOTAL: {format_number(total_area_mensura, 2)} m2 ({format_number(total_area_ha, 4)} ha)"
    else:
        area_total_str = f"AREA TOTAL: {format_number(total_area_mensura, 2)} m2"

    line_h = text_h * 1.5
    start_y = box_y + box_h - line_h
    
    draw_left_text(msp, box_x + text_h * 0.6, start_y, text_h * 0.85, f"PROYECTO: {project_name[:28]}", layer='TEXTOS', style=text_style)
    draw_left_text(msp, box_x + text_h * 0.6, start_y - line_h, text_h * 0.80, area_total_str, layer='TEXTOS', style=text_style)
    draw_left_text(msp, box_x + text_h * 0.6, start_y - line_h * 2, text_h * 0.80, f"PERIMETRO TOTAL: {format_number(total_perim, 2)} m", layer='TEXTOS', style=text_style)
    draw_left_text(msp, box_x + text_h * 0.6, start_y - line_h * 3, text_h * 0.85, f"ESCALA DE DIBUJO: 1:{int(print_scale)}", layer='TEXTOS', style=text_style)
    draw_left_text(msp, box_x + text_h * 0.6, start_y - line_h * 4, text_h * 0.70, f"DATUM: {datum_str}", layer='TEXTOS', style=text_style)


    
    # ================= 8. MARCA DE AGUA OPCIONAL (CAPA DEMO_WATERMARK_GEOTRANSFORMER) ================= //
    should_watermark = bool(
        payload.get('watermark')
        or (isinstance(metadata, dict) and metadata.get('demoWatermark'))
    )
    if should_watermark:
        wm_layer = 'DEMO_WATERMARK_GEOTRANSFORMER'
        if wm_layer not in doc.layers:
            doc.layers.new(wm_layer, dxfattribs={'color': 1})
        else:
            doc.layers.get(wm_layer).dxf.color = 1

        wm_h_main = max(text_h * 2.2, min(plot_box['w'], plot_box['h']) * 0.032)
        wm_h_sub = wm_h_main * 0.65

        # Marca de agua diagonal sobre el polígono / área de dibujo
        draw_centered_text(
            msp, cx, cy + wm_h_main * 0.8, wm_h_main,
            'VERSION DEMO - GEOGIS6 - SIN VALIDEZ CATASTRAL OFICIAL',
            rotation=30, layer=wm_layer, style=text_style
        )
        draw_centered_text(
            msp, cx, cy - wm_h_main * 0.8, wm_h_sub,
            'DOCUMENTO DE EVALUACION TECNICA - PROHIBIDA SU REPRODUCCION COMERCIAL',
            rotation=30, layer=wm_layer, style=text_style
        )

        # Marca de agua diagonal sobre el área de tablas/membrete
        sheet_wm_x = middle_box['x'] + (middle_box['w'] + side_box['w']) * 0.5
        sheet_wm_y = inner['y'] + inner['h'] * 0.5
        draw_centered_text(
            msp, sheet_wm_x, sheet_wm_y, wm_h_main * 0.85,
            'VERSION DEMO - SIN VALIDEZ OFICIAL',
            rotation=30, layer=wm_layer, style=text_style
        )

    ext_min = (outer['x'] - margin, outer['y'] - margin, 0.0)
    ext_max = (outer['x'] + outer['w'] + margin, outer['y'] + outer['h'] + margin, 0.0)
    doc.header['$EXTMIN'] = ext_min
    doc.header['$EXTMAX'] = ext_max
    doc.header['$LIMMIN'] = (ext_min[0], ext_min[1])
    doc.header['$LIMMAX'] = (ext_max[0], ext_max[1])
    doc.header['$DIMSCALE'] = print_scale

    # Encuadrar automáticamente la cámara inicial (*Active VPORT)
    # para que al abrir el DXF en AutoCAD/Civil3D/BricsCAD aparezca el plano completo
    # en pantalla sin necesidad de ejecutar ZOOM -> EXTENTS (Z E).
    view_cx = outer['x'] + outer['w'] * 0.5
    view_cy = outer['y'] + outer['h'] * 0.5
    view_w = (outer['w'] + margin * 2.0) * 1.06
    view_h = max((outer['h'] + margin * 2.0) * 1.06, view_w / 1.34)
    view_aspect = max(1.34, view_w / max(1e-6, view_h))

    try:
        from ezdxf import zoom
        zoom.extents(msp, factor=1.08)
    except Exception:
        pass

    try:
        active_vports = [vp for vp in doc.viewports if str(vp.dxf.name).upper() == '*ACTIVE']
        if not active_vports:
            vp = doc.viewports.new('*Active')
            active_vports = [vp]
        for vp in active_vports:
            vp.dxf.center = (view_cx, view_cy)
            vp.dxf.height = view_h
            vp.dxf.aspect_ratio = view_aspect
            vp.dxf.target = (0.0, 0.0, 0.0)
            vp.dxf.direction = (0.0, 0.0, 1.0)
    except Exception as e:
        print(f"Warning setting active viewport zoom: {e}", file=sys.stderr)

    try:
        auditor = doc.audit()
        if auditor.has_errors:
            auditor.fixes
    except Exception:
        pass

    doc.saveas(output_path)

    import gc
    gc.collect()

    # Retornar output_path (.dxf) limpio y 100% autónomo
    print(json.dumps({
        'status': 'success',
        'file': output_path,
        'dxf_file': output_path
    }))
    
    # Persistencia desactivada: state/render_state.json se eliminó por I/O innecesario
    # que además causaba errores de permisos en producción sin beneficio real.

    # Generación SVG deshabilitada para producción
    # svg_path = output_path.replace('.dxf', '.svg')
    # try:
    #     from ezdxf.addons.drawing import RenderContext, Frontend, layout, config
    #     from ezdxf.addons.drawing.svg import SVGBackend
    #     from ezdxf.addons.drawing.config import TextPolicy
    #     ctx = RenderContext(doc)
    #     ctx.set_current_layout(msp)
    #     backend = SVGBackend()
    #     svg_config = config.Configuration(
    #         color_policy=config.ColorPolicy.COLOR,
    #         background_policy=config.BackgroundPolicy.WHITE,
    #         text_policy=TextPolicy.OUTLINE,
    #         show_defpoints=False,
    #     )
    #     frontend = Frontend(ctx, backend, config=svg_config)
    #     frontend.draw_layout(msp)
    #     bounds = frontend.estimate_bounding_box()
    #     page = layout.Page(
    #         width=float(bounds.size.x),
    #         height=float(bounds.size.y),
    #         units=layout.Units.mm,
    #         margins=layout.Margins(0, 0, 0, 0),
    #     )
    #     with open(svg_path, 'w', encoding='utf-8') as f:
    #         f.write(backend.get_string(page))
    #     print(json.dumps({'status': 'success', 'file': output_path, 'svg_file': svg_path}))
    # except Exception as e:
    #     print(json.dumps({'status': 'success', 'file': output_path, 'warning': f'SVG generation failed: {e}'}))
        
    
if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(json.dumps({'status': 'error', 'message': str(e), 'traceback': tb}))
        sys.exit(1)
