"""
render_sat.py  —  GeoTransformer v6.0
Pipeline DXF-Satelital independiente.

Diferencias respecto a render.py:
  - Imagen satelital SIEMPRE incluida (es el propósito del script)
  - Detección automática de EPSG por centroide Este (zona 19/20/21 REGVEN)
  - Ruta relativa "./sat_<stem>.png" en la entidad IMAGE del DXF
  - Descarga de tiles ESRI en grilla 3×3 con offsets correctos
  - ZIP final: {stem}.zip  conteniendo  {stem}.dxf + sat_{stem}.png
  - Verificación de integridad del PNG cacheado antes de reutilizarlo
"""

import sys
import urllib.parse
import json
import math
import datetime
import zipfile
from pathlib import Path
import os
import ezdxf
from ezdxf.math import Matrix44
try:
    from ezdxf.enums import TextEntityAlignment
except Exception:
    from ezdxf import const as _const
    class TextEntityAlignment:
        LEFT = _const.TEXT_ALIGNMENT_LEFT
        MIDDLE_CENTER = _const.TEXT_ALIGNMENT_MIDDLE_CENTER

import unicodedata
import re

ezdxf.options.support_dir = str(Path(__file__).parent / "fonts")


# ── EPSG automático ───────────────────────────────────────────────────────────

def detect_epsg_regven(cx_utm: float) -> int:
    """
    Detecta el EPSG REGVEN según la coordenada Este del centroide.
    REGVEN usa el mismo sistema de zonas UTM que WGS84 pero con datum local.
      Zona 19 (EPSG 2201): Este < ~500 000 (aprox. <66°W)
      Zona 20 (EPSG 2202): 500 000 – 1 000 000  (la más común en Venezuela)
      Zona 21 (EPSG 2203): Este > 1 000 000 (este extremo)

    Fallback seguro a 2202 si no se puede determinar.
    """
    if cx_utm < 500_000:
        return 2201
    elif cx_utm < 1_000_000:
        return 2202
    else:
        return 2203


# ── Descarga de imagen satelital ─────────────────────────────────────────────

def fetch_satellite_image_sat(cx_utm: float, cy_utm: float,
                               box_w_m: float, box_h_m: float,
                               epsg_in: int = 2202,
                               output_dir: str | None = None,
                               stem: str = "sat") -> str | None:
    """
    Descarga imagen satelital centrada en (cx_utm, cy_utm) cubriendo
    box_w_m × box_h_m metros. Estrategia:
      1. Google Static Maps API (si GOOGLE_MAPS_API_KEY configurada)
      2. ESRI World Imagery — grilla 3×3 tiles con offsets correctos
      3. None → caller dibuja solo el polígono vectorial

    Retorna ruta absoluta al PNG, o None.
    """
    import tempfile
    import urllib.request
    import urllib.error
    import io

    # 1. Convertir UTM → WGS84
    try:
        from pyproj import Transformer
        t = Transformer.from_crs(epsg_in, 4326, always_xy=True)
        lon_c, lat_c = t.transform(cx_utm, cy_utm)
    except Exception as e:
        print(f"[SAT] pyproj transform failed (EPSG {epsg_in}): {e}", file=sys.stderr)
        return None

    # 2. Calcular zoom óptimo
    MAX_DIM = max(box_w_m, box_h_m)
    cos_lat = max(math.cos(math.radians(lat_c)), 0.01)
    zoom = 15
    for z in range(20, 12, -1):
        tile_m = (156_543.03 / (2 ** z)) * cos_lat * 256
        if tile_m >= MAX_DIM * 1.4:
            zoom = z
            break
    zoom = max(13, min(zoom, 19))

    if output_dir is None:
        output_dir = tempfile.gettempdir()
    img_path = os.path.join(output_dir, f"sat_{stem}.png")

    # 3. Cache hit — verificar integridad mínima
    if os.path.exists(img_path):
        try:
            size = os.path.getsize(img_path)
            if size > 5_000:  # PNG válido mínimo
                print(f"[SAT] Cache hit válido: {img_path} ({size} bytes)", file=sys.stderr)
                return img_path
            else:
                print(f"[SAT] Cache corrupto ({size} bytes), re-descargando", file=sys.stderr)
                os.remove(img_path)
        except Exception:
            pass

    headers = {"User-Agent": "GeoTransformer-DXF/6.0 (+https://geotransformer.app)"}

    # 4. Google Static Maps (prioritario si hay API key)
    google_key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if google_key:
        try:
            params = urllib.parse.urlencode({
                "center": f"{lat_c:.6f},{lon_c:.6f}",
                "zoom": zoom,
                "size": "640x640",
                "maptype": "satellite",
                "key": google_key,
            })
            url = f"https://maps.googleapis.com/maps/api/staticmap?{params}"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            if len(data) > 5_000:
                with open(img_path, "wb") as f:
                    f.write(data)
                print(f"[SAT] Google satellite OK (zoom={zoom})", file=sys.stderr)
                return img_path
        except Exception as e:
            print(f"[SAT] Google Static Maps failed: {e}", file=sys.stderr)

    # 5. ESRI World Imagery — grilla 3×3 con offsets correctos
    try:
        from PIL import Image
        n = 2 ** zoom
        tx = int((lon_c + 180.0) / 360.0 * n)
        lat_r = math.radians(lat_c)
        ty = int((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n)

        TILE_PX = 256
        GRID = [-1, 0, 1]  # 3×3 grilla
        CANVAS_SIZE = TILE_PX * 3  # 768×768
        canvas = Image.new("RGB", (CANVAS_SIZE, CANVAS_SIZE), (30, 30, 30))
        placed = 0

        import concurrent.futures

        def download_tile_sat(dtx, dty):
            ttx, tty = tx + dtx, ty + dty
            tile_url = (
                f"https://server.arcgisonline.com/ArcGIS/rest/services/"
                f"World_Imagery/MapServer/tile/{zoom}/{tty}/{ttx}"
            )
            try:
                req = urllib.request.Request(tile_url, headers=headers)
                with urllib.request.urlopen(req, timeout=5) as resp:
                    tile_data = resp.read()
                tile_img = Image.open(io.BytesIO(tile_data)).convert("RGB")
                return dtx, dty, tile_img
            except Exception as e:
                # tile faltante → zona oscura en canvas
                return None

        coords = [(dtx, dty) for dty in GRID for dtx in GRID]
        # Limitar a 3 workers concurrentes para no saturar los 512 MB de RAM en Render Free
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            results = list(executor.map(lambda c: download_tile_sat(c[0], c[1]), coords))

        for res in results:
            if res is not None:
                dtx, dty, tile_img = res
                px_x = (dtx + 1) * TILE_PX
                px_y = (dty + 1) * TILE_PX
                canvas.paste(tile_img.resize((TILE_PX, TILE_PX)), (px_x, px_y))
                placed += 1

        if placed > 0:
            # Recortar al tile central + medio tile de contexto → 512×512 centrado
            cx_px = CANVAS_SIZE // 2
            cy_px = CANVAS_SIZE // 2
            half = TILE_PX  # 256px de radio → 512×512 crop
            cropped = canvas.crop((cx_px - half, cy_px - half, cx_px + half, cy_px + half))
            cropped.save(img_path, "PNG", optimize=True)
            print(f"[SAT] ESRI grilla 3×3 OK (zoom={zoom}, tiles={placed}/9)", file=sys.stderr)
            
            # Liberación explícita de buffers en memoria
            import gc
            del canvas, cropped
            gc.collect()
            
            return img_path

    except Exception as e:
        print(f"[SAT] ESRI tiles failed: {e}", file=sys.stderr)

    return None


# ── Embed de imagen en DXF con ruta relativa ─────────────────────────────────

def embed_satellite_relative(doc, msp, img_abs_path: str, img_rel_name: str,
                              croq_box: dict, attribution: str = "Img: Esri / Google"):
    """
    Incrusta la imagen satelital en el DXF usando una ruta RELATIVA
    (solo el nombre de archivo, no la ruta del servidor).
    De esta forma, si el cliente descomprime el ZIP en una carpeta,
    AutoCAD/DraftSight encontrará la imagen automáticamente.
    """
    try:
        from PIL import Image as PILImage
        img = PILImage.open(img_abs_path)
        px_w, px_h = img.size

        # ← ruta relativa: solo el basename
        image_def = doc.add_image_def(
            filename=img_rel_name,
            size_in_pixel=(px_w, px_h)
        )

        if "IMAGEN_SAT" not in doc.layers:
            doc.layers.new("IMAGEN_SAT", dxfattribs={"color": 7})

        image_entity = msp.add_image(
            insert=(croq_box["x"], croq_box["y"]),
            size_in_units=(croq_box["w"], croq_box["h"]),
            image_def=image_def,
            rotation=0,
            dxfattribs={"layer": "IMAGEN_SAT"}
        )

        # Activar visualización (ezdxf >= 1.0)
        try:
            from ezdxf.entities.image import Image as _DxfImage
            image_entity.set_flag_state(_DxfImage.SHOW_IMAGE, True)
            image_entity.set_flag_state(_DxfImage.USE_CLIPPING_BOUNDARY, False)
        except Exception as e:
            print(f"[SAT] set_flag_state warning: {e}", file=sys.stderr)

        # Atribución en la esquina inferior izquierda del recuadro
        attr_h = max(croq_box["h"] * 0.028, 0.4)
        draw_left_text(
            msp,
            croq_box["x"] + croq_box["w"] * 0.015,
            croq_box["y"] + attr_h * 0.5,   # dentro del recuadro
            attr_h,
            attribution,
            layer="TEXTOS",
            style="GEO_ARIAL"
        )
        print(
            f"[SAT] Embed OK → '{img_rel_name}' "
            f"({croq_box['w']:.1f}×{croq_box['h']:.1f} u)",
            file=sys.stderr
        )
        return True
    except Exception as e:
        print(f"[SAT] embed_satellite_relative failed: {e}", file=sys.stderr)
        return False


# ── Helpers (copiados de render.py para independencia total) ──────────────────

def clean_text(value, fallback=''):
    if value is None:
        return fallback
    import unicodedata, re
    nfkd = unicodedata.normalize('NFKD', str(value))
    ascii_only = nfkd.encode('ascii', 'ignore').decode('ascii')
    cleaned = re.sub(r'[^\x20-\x7E]', '', ascii_only)
    return cleaned.strip() or fallback

def validate_layers(doc):
    required = {
        'MARCO': 7, 'POLIGONO': 10, 'TEXTOS': 7,
        'GRILLA': 8, 'COTAS': 230, 'IMAGEN_SAT': 7
    }
    for name, color in required.items():
        if name not in doc.layers:
            doc.layers.new(name, dxfattribs={'color': color})
        else:
            doc.layers.get(name).dxf.color = color

def format_number(value, decimals=3):
    try:
        fmt = f"{{:.{decimals}f}}"
        return fmt.format(float(value))
    except Exception:
        return str(value)

def get_bearing(dx, dy):
    az = math.degrees(math.atan2(dx, dy))
    if az < 0:
        az += 360
    quad = ''
    ref = 0.0
    if 0 <= az <= 90:
        quad = 'N'; ref = az; suf = 'E'
    elif 90 < az <= 180:
        quad = 'S'; ref = 180 - az; suf = 'E'
    elif 180 < az <= 270:
        quad = 'S'; ref = az - 180; suf = 'O'
    else:
        quad = 'N'; ref = 360 - az; suf = 'O'
    deg = int(ref)
    mm = int((ref - deg) * 60)
    ss = int(((ref - deg) * 60 - mm) * 60)
    return f"{quad}{deg}°{mm:02d}'{ss:02d}\"{suf}"

def nice_step(value_range):
    if value_range <= 0:
        return 10.0
    raw = value_range / 5.0
    power = 10.0 ** math.floor(math.log10(raw)) if raw > 0 else 1.0
    norm = raw / power
    if norm <= 1: snap = 1.0
    elif norm <= 2: snap = 2.0
    elif norm <= 2.5: snap = 2.5
    elif norm <= 5: snap = 5.0
    else: snap = 10.0
    return snap * power

def calculate_geometry(points):
    area = 0.0; perim = 0.0; n = len(points)
    for i in range(n):
        p1 = points[i]; p2 = points[(i + 1) % n]
        area += p1['x'] * p2['y'] - p2['x'] * p1['y']
        perim += math.hypot(p2['x'] - p1['x'], p2['y'] - p1['y'])
    return {'area': area / 2.0, 'perim': perim, 'signedArea': area / 2.0}

def draw_line(msp, x1, y1, x2, y2, layer='MARCO', linetype=None, **kw):
    a = {'layer': layer}
    if linetype: a['linetype'] = linetype
    msp.add_line((x1, y1), (x2, y2), dxfattribs=a)

def draw_circle(msp, cx, cy, radius, layer='TEXTOS', **kw):
    msp.add_circle((cx, cy), radius, dxfattribs={'layer': layer})

def draw_rect(msp, x, y, w, h, thickness=0.0, layer='MARCO', **kw):
    pts = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    a = {'layer': layer}
    if thickness > 0: a['const_width'] = thickness
    msp.add_lwpolyline(pts, close=True, dxfattribs=a)

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
            msp.add_blockref('NORTE', (cx - 700.96 * scale, cy - 488.98 * scale), dxfattribs={
                'xscale': scale, 'yscale': scale, 'layer': 'TEXTOS'
            })
            return
        except Exception as e:
            print(f"[NORTE block] {e}", file=sys.stderr)
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
    draw_centered_text(msp, cx, cy + size * 1.2, text_h, 'N', style=style)
    draw_centered_text(msp, cx, cy - size * 1.5, text_h, 'S', style=style)
    draw_centered_text(msp, cx + size * 1.3, cy - text_h * 0.5, text_h, 'E', style=style)
    draw_centered_text(msp, cx - size * 1.3, cy - text_h * 0.5, text_h, 'O', style=style)

def _extract_coords(pt):
    x = y = None
    for k in ('x', 'este', 'e'):
        if k in pt and pt[k] is not None:
            x = float(pt[k]); break
    for k in ('y', 'norte', 'n'):
        if k in pt and pt[k] is not None:
            y = float(pt[k]); break
    if x is None or y is None:
        res = pt.get('result')
        if isinstance(res, dict):
            if x is None:
                for k in ('este', 'x', 'e'):
                    if k in res and res[k] is not None:
                        x = float(res[k]); break
            if y is None:
                for k in ('norte', 'y', 'n'):
                    if k in res and res[k] is not None:
                        y = float(res[k]); break
    return x, y


# ── main() ────────────────────────────────────────────────────────────────────

def main():
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({'status': 'error', 'message': 'No input data'}))
            sys.exit(1)
        data = json.loads(input_data)
        template_path = data.get('template_path')
        output_path   = data.get('output_path')   # ruta del .dxf
        payload       = data.get('payload', {})
        if not template_path or not output_path or not payload:
            print(json.dumps({'status': 'error', 'message': 'Faltan campos requeridos'}))
            sys.exit(1)
    except Exception as e:
        print(json.dumps({'status': 'error', 'message': f'Input inválido: {e}'}))
        sys.exit(1)

    # ── Extraer parámetros ───────────────────────────────────────────────────
    points        = payload.get('points') or payload.get('puntos', [])
    metadata      = payload.get('metadata', {})
    geometry_type = payload.get('geometryType') or metadata.get('geometryType', 'cerrada')
    text_style    = payload.get('textStyle', 'GEO_ARIAL')
    dxf_scale_factor = float(payload.get('dxfScaleFactor', 1.0))
    dxf_offset_x  = float(payload.get('dxfOffsetX', 0))
    dxf_offset_y  = float(payload.get('dxfOffsetY', 0))

    output_dir    = str(Path(output_path).parent)
    stem          = Path(output_path).stem   # nombre sin extensión

    # ── Cargar plantilla DXF ─────────────────────────────────────────────────
    has_template_blocks = True
    try:
        doc = ezdxf.readfile(template_path)
        if 'Layout1' not in doc.layouts.names():
            doc.layouts.new('Layout1')
        for name in list(doc.layouts.names()):
            if name.upper() != 'MODEL' and name != 'Layout1':
                try: doc.layouts.delete(name)
                except Exception: pass
        msp = doc.modelspace()
        for entity in list(msp):
            if entity.dxf.layer != 'NOTAS':
                msp.delete_entity(entity)
    except Exception as e:
        print(f"[TMPL] {e}", file=sys.stderr)
        doc = ezdxf.new('R2010')
        doc.header['$INSUNITS'] = 6
        has_template_blocks = False

    doc.header['$TEXTSTYLE'] = 'GEO_ARIAL'

    # Registrar estilos de texto
    for sn, fn, _ in [('GEO_ARIAL', 'arial.ttf', True), ('GEO_SHX', 'simplex.shx', False),
                       ('STANDARD', 'Arial', True), ('ROMANS', 'Arial', True)]:
        if sn in doc.styles:
            s = doc.styles.get(sn)
        else:
            s = doc.styles.new(sn)
        s.dxf.font = fn; s.dxf.height = 0.0; s.dxf.width = 1.0

    validate_layers(doc)
    msp = doc.modelspace()

    # ── Parsear puntos ───────────────────────────────────────────────────────
    parsed_pts = []
    for idx, pt in enumerate(points):
        xv, yv = _extract_coords(pt)
        if xv is not None and yv is not None:
            pid = clean_text(pt.get('id', str(idx + 1)), str(idx + 1))
            parsed_pts.append({'x': xv, 'y': yv, 'id': pid})

    raw_xs = [p['x'] for p in parsed_pts]
    raw_ys = [p['y'] for p in parsed_pts]
    cx_raw = (min(raw_xs) + max(raw_xs)) / 2.0 if raw_xs else 0.0
    cy_raw = (min(raw_ys) + max(raw_ys)) / 2.0 if raw_ys else 0.0

    # Detectar EPSG automáticamente desde el centroide Este
    epsg_in = int(metadata.get('epsg', detect_epsg_regven(cx_raw)))
    print(f"[SAT] EPSG detectado: {epsg_in} (cx_raw={cx_raw:.1f})", file=sys.stderr)

    # Aplicar escala y offset DXF
    parsed_pts = [
        {'x': (p['x'] + dxf_offset_x) * dxf_scale_factor,
         'y': (p['y'] + dxf_offset_y) * dxf_scale_factor,
         'id': p['id']}
        for p in parsed_pts
    ]
    if len(parsed_pts) < 3:
        raise ValueError("La parcela debe tener al menos 3 vértices válidos.")

    xs = [p['x'] for p in parsed_pts]; ys = [p['y'] for p in parsed_pts]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    data_w = max_x - min_x; data_h = max_y - min_y
    cx = (min_x + max_x) / 2.0; cy = (min_y + max_y) / 2.0

    geo = calculate_geometry(parsed_pts)
    area_mensura = abs(geo['area']); perim = geo['perim']; is_ccw = geo['signedArea'] > 0

    # ── Metadatos ────────────────────────────────────────────────────────────
    area_doc      = float(metadata.get('areaDoc', area_mensura)) if metadata.get('areaDoc') else area_mensura
    raw_pname     = metadata.get('projectName', 'PARCELA')
    project_name  = clean_text(urllib.parse.unquote(raw_pname) if isinstance(raw_pname, str) else raw_pname, 'PARCELA')
    estado        = clean_text(metadata.get('estado',       'MIRANDA')).upper()
    municipio     = clean_text(metadata.get('municipio',    'CHACAO')).upper()
    parroquia     = clean_text(metadata.get('parroquia',    'EL ROSAL')).upper()
    propietario   = clean_text(metadata.get('propietario',  'S/D')).upper()
    profesional   = clean_text(metadata.get('profesional',  'ING. CATASTRAL / GEODESTA')).upper()
    civ           = clean_text(metadata.get('civ',          'C.I.V. 285.120')).upper()
    zona          = clean_text(metadata.get('zona',         'U-1')).upper()
    seccion       = clean_text(metadata.get('seccion',      'A-12')).upper()
    cedula_cat    = clean_text(metadata.get('cedulaCat',    '15-02-01-U-123')).upper()
    observaciones = clean_text(metadata.get('observaciones',
        'NINGUNA. MEDIDAS TOPOGRAFICAS DE ALTA PRECISION UTM REFERIDAS AL DATUM REGVEN.')).upper()

    # ── Escala de impresión ──────────────────────────────────────────────────
    padding  = 1.35
    scale_w  = (data_w * padding) / (0.420 * 0.51)
    scale_h  = (data_h * padding) / (0.297 * 0.90)
    raw_scale = max(scale_w, scale_h, 250.0)
    power = 10.0 ** math.floor(math.log10(raw_scale))
    norm = raw_scale / power
    snap = 1.0 if norm <= 1 else 2.0 if norm <= 2 else 2.5 if norm <= 2.5 else 5.0 if norm <= 5 else 10.0
    print_scale = snap * power

    sheet_w = 0.420 * print_scale; sheet_h = 0.297 * print_scale
    margin  = sheet_h * 0.02

    outer = {'x': 0.0, 'y': 0.0, 'w': sheet_w, 'h': sheet_h}
    inner = {'x': margin, 'y': margin, 'w': sheet_w - 2*margin, 'h': sheet_h - 2*margin}
    map_box    = {'x': inner['x'], 'y': inner['y'], 'w': inner['w'] * 0.50, 'h': inner['h']}
    middle_box = {'x': map_box['x'] + map_box['w'], 'y': inner['y'], 'w': inner['w'] * 0.25, 'h': inner['h']}
    side_box   = {'x': middle_box['x'] + middle_box['w'], 'y': inner['y'], 'w': inner['w'] * 0.25, 'h': inner['h']}

    plot_box = {'x': cx - map_box['w']/2, 'y': cy - map_box['h']/2, 'w': map_box['w'], 'h': map_box['h']}
    sheet_offset = {'x': plot_box['x'] - map_box['x'], 'y': plot_box['y'] - map_box['y']}

    for box in (outer, inner, map_box, middle_box, side_box):
        box['x'] += sheet_offset['x']; box['y'] += sheet_offset['y']

    # Transformar entidades NOTAS (logotipo)
    notas_matrix = (
        Matrix44.translate(sheet_offset['x'], sheet_offset['y'], 0.0)
        @ Matrix44.scale(print_scale, print_scale, 1.0)
    )
    for entity in list(msp):
        if entity.dxf.layer == 'NOTAS':
            try: entity.transform(notas_matrix)
            except Exception as e:
                print(f"[NOTAS] {entity.dxftype()}: {e}", file=sys.stderr)

    frame_thickness = print_scale * 0.0004
    poly_thickness  = print_scale * 0.0006
    text_h = print_scale * 0.0030  # 3.0 mm en papel para legibilidad óptima

    # ── 2. Bordes ────────────────────────────────────────────────────────────
    draw_rect(msp, outer['x'], outer['y'], outer['w'], outer['h'], layer='MARCO')
    draw_rect(msp, inner['x'], inner['y'], inner['w'], inner['h'], thickness=frame_thickness, layer='MARCO')
    draw_line(msp, middle_box['x'], inner['y'], middle_box['x'], inner['y'] + inner['h'])
    draw_line(msp, side_box['x'],   inner['y'], side_box['x'],   inner['y'] + inner['h'])

    # ── 3. Grilla UTM ────────────────────────────────────────────────────────
    grid_step = nice_step(max(data_w, data_h))
    grid_dash = max(1.0, grid_step * 0.02)
    if 'GRILLA_PUNTEADA' not in doc.linetypes:
        doc.linetypes.add('GRILLA_PUNTEADA', pattern=[grid_dash, -grid_dash], description='Grilla _ _')
    if 'GRILLA' in doc.layers:
        try: doc.layers.get('GRILLA').dxf.linetype = 'GRILLA_PUNTEADA'
        except Exception: pass

    gx = math.ceil(plot_box['x'] / grid_step) * grid_step
    while gx <= plot_box['x'] + plot_box['w']:
        draw_line(msp, gx, plot_box['y'], gx, plot_box['y'] + plot_box['h'], layer='GRILLA', linetype='GRILLA_PUNTEADA')
        txt = f"E {int(round(gx))}"
        draw_left_text(msp, gx - text_h*0.3, plot_box['y'] + len(txt)*text_h*0.65 + text_h, text_h, txt, rotation=90, layer='TEXTOS', style=text_style)
        gx += grid_step
    gy = math.ceil(plot_box['y'] / grid_step) * grid_step
    while gy <= plot_box['y'] + plot_box['h']:
        draw_line(msp, plot_box['x'], gy, plot_box['x'] + plot_box['w'], gy, layer='GRILLA', linetype='GRILLA_PUNTEADA')
        draw_left_text(msp, plot_box['x'] + text_h*0.5, gy + text_h*0.3, text_h, f"N {int(round(gy))}", layer='TEXTOS', style=text_style)
        gy += grid_step

    # ── 4. Polígono y anotaciones ────────────────────────────────────────────
    inner_radius = min(data_w, data_h, math.sqrt(area_mensura))
    interior_text_h = max(min(text_h * 1.2, inner_radius * 0.08), print_scale * 0.001)
    avg_edge = perim / len(parsed_pts)
    min_edge = min(
        (math.hypot(parsed_pts[(i+1)%len(parsed_pts)]['x']-parsed_pts[i]['x'],
                    parsed_pts[(i+1)%len(parsed_pts)]['y']-parsed_pts[i]['y'])
         for i in range(len(parsed_pts))),
        default=avg_edge
    )
    vertex_text_h = max(min(text_h, avg_edge*0.15, min_edge*0.35), print_scale*0.0008)
    v_id_h = vertex_text_h * 1.3; v_dist_h = vertex_text_h * 0.95
    marker_radius = vertex_text_h * 0.55

    if geometry_type != 'puntos':
        verts = [(p['x'], p['y']) for p in parsed_pts]
        msp.add_lwpolyline(verts, close=(geometry_type == 'cerrada'),
                           dxfattribs={'layer': 'POLIGONO', 'const_width': poly_thickness})

    for i, p in enumerate(parsed_pts):
        pn = parsed_pts[(i+1) % len(parsed_pts)]
        dx = pn['x'] - p['x']; dy = pn['y'] - p['y']
        length = math.hypot(dx, dy)
        if length > 0:
            nx = (dy/length if is_ccw else -dy/length)
            ny = (-dx/length if is_ccw else dx/length)
            dist_offset = vertex_text_h * 3.0
            mid_x = (p['x'] + pn['x']) / 2; mid_y = (p['y'] + pn['y']) / 2
            text_rot = math.degrees(math.atan2(dy, dx))
            if text_rot > 90: text_rot -= 180
            elif text_rot < -90: text_rot += 180
            draw_centered_text(msp, mid_x + nx*dist_offset, mid_y + ny*dist_offset,
                               v_dist_h, format_number(length, 2), rotation=text_rot, layer='COTAS', style=text_style)
            lx = p['x'] + nx*marker_radius*8; ly = p['y'] + ny*marker_radius*8
            draw_centered_text(msp, lx, ly + v_id_h*0.5, v_id_h*0.95, p['id'], layer='TEXTOS', style=text_style)
        else:
            draw_centered_text(msp, p['x'], p['y'] + marker_radius*2, v_id_h, p['id'], layer='TEXTOS', style=text_style)
        draw_circle(msp, p['x'], p['y'], marker_radius, layer='TEXTOS')

    draw_centered_text(msp, cx, cy + interior_text_h*1.8, interior_text_h*1.2, project_name, layer='TEXTOS', style=text_style)
    draw_circle(msp, plot_box['x']+text_h*5, plot_box['y']+plot_box['h']-text_h*5, text_h*2.5, layer='TEXTOS')
    draw_line(msp, plot_box['x']+text_h*2, plot_box['y']+plot_box['h']-text_h*5,
                   plot_box['x']+text_h*8, plot_box['y']+plot_box['h']-text_h*5, layer='TEXTOS')
    draw_line(msp, plot_box['x']+text_h*5, plot_box['y']+plot_box['h']-text_h*2,
                   plot_box['x']+text_h*5, plot_box['y']+plot_box['h']-text_h*8, layer='TEXTOS')

    # ── 5. Columna central: tablas ───────────────────────────────────────────
    table_unit = inner['h'] / 100.0
    t_y = inner['y'] + inner['h'] - table_unit * 2.0

    # Balance de superficie
    bal_h = table_unit * 10.0
    draw_rect(msp, middle_box['x']+margin, t_y-bal_h, middle_box['w']-2*margin, bal_h, thickness=frame_thickness*0.5)
    draw_line(msp, middle_box['x']+margin, t_y-bal_h*0.3, middle_box['x']+middle_box['w']-margin, t_y-bal_h*0.3)
    draw_line(msp, middle_box['x']+margin+middle_box['w']*0.6, t_y-bal_h*0.3,
                   middle_box['x']+margin+middle_box['w']*0.6, t_y-bal_h)
    draw_centered_text(msp, middle_box['x']+middle_box['w']/2, t_y-bal_h*0.15-text_h*0.35, text_h, 'BALANCE DE SUPERFICIE', style=text_style)
    rcc = middle_box['x']+margin+middle_box['w']*0.6+(middle_box['w']*0.4-2*margin)/2
    bal_lbl_h_sat = max(print_scale * 0.0018, min(text_h * 0.55, table_unit * 1.35))  # etiquetas pequeñas
    draw_left_text(msp, middle_box['x']+margin*1.5, t_y-bal_h*0.5-text_h*0.35, bal_lbl_h_sat, 'AREA SEGUN DOCUMENTO', style=text_style)
    draw_left_text(msp, middle_box['x']+margin*1.5, t_y-bal_h*0.85-text_h*0.35, bal_lbl_h_sat, 'AREA SEGUN MENSURA', style=text_style)
    draw_centered_text(msp, rcc, t_y-bal_h*0.5-text_h*0.35, text_h*0.9, f"{format_number(area_doc,2)} m2", style=text_style)
    draw_centered_text(msp, rcc, t_y-bal_h*0.85-text_h*0.35, text_h*0.9, f"{format_number(area_mensura,2)} m2", style=text_style)
    t_y -= bal_h + table_unit*4

    # Punto de apoyo
    pa_h = table_unit * 15.0
    draw_rect(msp, middle_box['x']+margin, t_y-pa_h, middle_box['w']-2*margin, pa_h, thickness=frame_thickness*0.5)
    draw_line(msp, middle_box['x']+margin, t_y-pa_h*0.2, middle_box['x']+middle_box['w']-margin, t_y-pa_h*0.2)
    draw_line(msp, middle_box['x']+margin, t_y-pa_h*0.4, middle_box['x']+middle_box['w']-margin, t_y-pa_h*0.4)
    draw_line(msp, middle_box['x']+margin, t_y-pa_h*0.6, middle_box['x']+middle_box['w']-margin, t_y-pa_h*0.6)
    pa_c1=middle_box['w']*0.2; pa_c2=middle_box['w']*0.4; pa_c3=middle_box['w']*0.4-2*margin
    draw_line(msp, middle_box['x']+margin+pa_c1, t_y-pa_h*0.6, middle_box['x']+margin+pa_c1, t_y-pa_h)
    draw_line(msp, middle_box['x']+margin+pa_c1+pa_c2, t_y-pa_h*0.6, middle_box['x']+margin+pa_c1+pa_c2, t_y-pa_h)
    draw_centered_text(msp, middle_box['x']+middle_box['w']/2, t_y-pa_h*0.1-text_h*0.35, text_h, 'PUNTO DE APOYO (RED GEODESICA)', style=text_style)
    draw_centered_text(msp, middle_box['x']+middle_box['w']/2, t_y-pa_h*0.3-text_h*0.35, text_h*0.9, 'COORDENADAS REGVEN (UTM)', style=text_style)
    draw_centered_text(msp, middle_box['x']+margin+pa_c1*0.5, t_y-pa_h*0.7-text_h*0.35, text_h*0.9, 'PUNTO', style=text_style)
    draw_centered_text(msp, middle_box['x']+margin+pa_c1+pa_c2*0.5, t_y-pa_h*0.7-text_h*0.35, text_h*0.9, 'NORTE', style=text_style)
    draw_centered_text(msp, middle_box['x']+margin+pa_c1+pa_c2+pa_c3*0.5, t_y-pa_h*0.7-text_h*0.35, text_h*0.9, 'ESTE', style=text_style)
    draw_centered_text(msp, middle_box['x']+margin+pa_c1*0.5, t_y-pa_h*0.88-text_h*0.35, text_h*0.9, 'V.P.', style=text_style)
    draw_centered_text(msp, middle_box['x']+margin+pa_c1+pa_c2*0.5, t_y-pa_h*0.88-text_h*0.35, text_h*0.9, format_number(cy-200,2), style=text_style)
    draw_centered_text(msp, middle_box['x']+margin+pa_c1+pa_c2+pa_c3*0.5, t_y-pa_h*0.88-text_h*0.35, text_h*0.9, format_number(cx-200,2), style=text_style)
    t_y -= pa_h + table_unit*4

    avail = 54.0*table_unit; total_rows = len(parsed_pts)*2
    dyn_row_h = max(table_unit*1.8, min(table_unit*2.8, avail/total_rows))

    # Rumbos
    rum_h = table_unit*5 + len(parsed_pts)*dyn_row_h
    draw_rect(msp, middle_box['x']+margin, t_y-rum_h, middle_box['w']-2*margin, rum_h, thickness=frame_thickness*0.5)
    r_c1=middle_box['w']*0.12; r_c2=middle_box['w']*0.12; r_c3=middle_box['w']*0.46; r_c4=middle_box['w']*0.30-2*margin
    draw_line(msp, middle_box['x']+margin, t_y-table_unit*5, middle_box['x']+middle_box['w']-margin, t_y-table_unit*5)
    draw_line(msp, middle_box['x']+margin, t_y-table_unit*2.5, middle_box['x']+margin+r_c1+r_c2, t_y-table_unit*2.5)
    draw_line(msp, middle_box['x']+margin+r_c1, t_y-table_unit*2.5, middle_box['x']+margin+r_c1, t_y-rum_h)
    draw_line(msp, middle_box['x']+margin+r_c1+r_c2, t_y, middle_box['x']+margin+r_c1+r_c2, t_y-rum_h)
    draw_line(msp, middle_box['x']+margin+r_c1+r_c2+r_c3, t_y, middle_box['x']+margin+r_c1+r_c2+r_c3, t_y-rum_h)
    draw_cell_text(msp, middle_box['x']+margin+(r_c1+r_c2)*0.5, t_y-table_unit*1.25, text_h*0.88, 'LADO', style=text_style)
    draw_cell_text(msp, middle_box['x']+margin+r_c1*0.5, t_y-table_unit*3.75, text_h*0.78, 'EST', style=text_style)
    draw_cell_text(msp, middle_box['x']+margin+r_c1+r_c2*0.5, t_y-table_unit*3.75, text_h*0.78, 'PV', style=text_style)
    draw_cell_text(msp, middle_box['x']+margin+r_c1+r_c2+r_c3*0.5, t_y-table_unit*2.5, text_h*0.88, 'RUMBO', style=text_style)
    draw_cell_text(msp, middle_box['x']+margin+r_c1+r_c2+r_c3+r_c4*0.5, t_y-table_unit*2.5, text_h*0.80, 'DISTANCIA', style=text_style)
    for idx, p in enumerate(parsed_pts):
        pn = parsed_pts[(idx+1)%len(parsed_pts)]
        dist = math.hypot(pn['x']-p['x'], pn['y']-p['y'])
        y_top = t_y - table_unit*5 - idx*dyn_row_h
        ch = max(print_scale * 0.0035, min(text_h*0.92, dyn_row_h*0.68)); yc = y_top - dyn_row_h/2
        if idx > 0: draw_line(msp, middle_box['x']+margin, y_top, middle_box['x']+middle_box['w']-margin, y_top)
        draw_cell_text(msp, middle_box['x']+margin+r_c1*0.5, yc, ch, str(idx+1), style=text_style)
        draw_cell_text(msp, middle_box['x']+margin+r_c1+r_c2*0.5, yc, ch, str((idx+1)%len(parsed_pts)+1), style=text_style)
        draw_cell_text(msp, middle_box['x']+margin+r_c1+r_c2+r_c3*0.5, yc, ch, get_bearing(pn['x']-p['x'], pn['y']-p['y']), style=text_style)
        draw_cell_text(msp, middle_box['x']+margin+r_c1+r_c2+r_c3+r_c4*0.5, yc, ch, format_number(dist,3), style=text_style)
    t_y -= rum_h + table_unit*4

    # Coordenadas
    coo_h = table_unit*5 + len(parsed_pts)*dyn_row_h
    draw_rect(msp, middle_box['x']+margin, t_y-coo_h, middle_box['w']-2*margin, coo_h, thickness=frame_thickness*0.5)
    draw_line(msp, middle_box['x']+margin, t_y-table_unit*2.5, middle_box['x']+middle_box['w']-margin, t_y-table_unit*2.5)
    draw_line(msp, middle_box['x']+margin, t_y-table_unit*5, middle_box['x']+middle_box['w']-margin, t_y-table_unit*5)
    c_c1=middle_box['w']*0.15; c_c2=middle_box['w']*0.425; c_c3=middle_box['w']*0.425-2*margin
    draw_line(msp, middle_box['x']+margin+c_c1, t_y-table_unit*2.5, middle_box['x']+margin+c_c1, t_y-coo_h)
    draw_line(msp, middle_box['x']+margin+c_c1+c_c2, t_y-table_unit*2.5, middle_box['x']+margin+c_c1+c_c2, t_y-coo_h)
    draw_cell_text(msp, middle_box['x']+middle_box['w']/2, t_y-table_unit*1.25, text_h*0.88, 'COORDENADAS (U.T.M)', style=text_style)
    hy = t_y-3.75*table_unit
    draw_cell_text(msp, middle_box['x']+margin+c_c1*0.5, hy, text_h*0.78, 'PUNTO', style=text_style)
    draw_cell_text(msp, middle_box['x']+margin+c_c1+c_c2*0.5, hy, text_h*0.78, 'NORTE', style=text_style)
    draw_cell_text(msp, middle_box['x']+margin+c_c1+c_c2+c_c3*0.5, hy, text_h*0.78, 'ESTE', style=text_style)
    for idx, p in enumerate(parsed_pts):
        y_top = t_y-table_unit*5-idx*dyn_row_h
        ch = max(print_scale * 0.0038, min(text_h*0.95, dyn_row_h*0.72)); yc = y_top-dyn_row_h/2
        if idx > 0: draw_line(msp, middle_box['x']+margin, y_top, middle_box['x']+middle_box['w']-margin, y_top)
        draw_cell_text(msp, middle_box['x']+margin+c_c1*0.5, yc, ch, str(idx+1), style=text_style)
        draw_cell_text(msp, middle_box['x']+margin+c_c1+c_c2*0.5, yc, ch, format_number(p['y'],3), style=text_style)
        draw_cell_text(msp, middle_box['x']+margin+c_c1+c_c2+c_c3*0.5, yc, ch, format_number(p['x'],3), style=text_style)

    # ── 6. Carátula lateral ──────────────────────────────────────────────────
    s_unit = inner['h'] / 75.0
    s_y = inner['y'] + inner['h']

    # 6.1 Mensura Header
    s_y -= s_unit*6
    draw_line(msp, side_box['x'], s_y, side_box['x']+side_box['w'], s_y)
    draw_centered_text(msp, side_box['x']+side_box['w']/2, s_y+s_unit*4.5, text_h, 'MENSURA DE TERRENO', style=text_style)
    draw_left_text(msp, side_box['x']+side_box['w']*0.1, s_y+s_unit*3.0, text_h*0.8, f"ESTADO: {estado}", style=text_style)
    draw_left_text(msp, side_box['x']+side_box['w']*0.1, s_y+s_unit*1.8, text_h*0.8, f"MUNICIPIO: {municipio}", style=text_style)
    draw_left_text(msp, side_box['x']+side_box['w']*0.1, s_y+s_unit*0.6, text_h*0.8, f"PARROQUIA: {parroquia}", style=text_style)

    # 6.2 Amparada
    s_y -= s_unit*8
    draw_line(msp, side_box['x'], s_y, side_box['x']+side_box['w'], s_y)
    draw_centered_text(msp, side_box['x']+side_box['w']/2, s_y+s_unit*6.5, text_h*0.8, 'AMPARADA POR EL DOCUMENTO', style=text_style)
    reg_text = (f"OFICINA SUBALTERNA DE REGISTRO DE EL ESTADO {estado},"
                " BAJO EL NRO. ____, FOLIOS ____ AL ___, PROTOCOLO: ________ TRIMESTRE ______, Ano: ________")
    reg_words = reg_text.split(); reg_lines = []; curr = ""
    for w in reg_words:
        if len(curr)+len(w)+1 < 36: curr += (" " if curr else "")+w
        else: reg_lines.append(curr); curr = w
    if curr: reg_lines.append(curr)
    for ri, rl in enumerate(reg_lines[:4]):
        draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*5.0-ri*text_h*1.25, text_h*0.55, rl, style=text_style)

    # 6.3 Antecedentes
    s_y -= s_unit*12
    draw_line(msp, side_box['x'], s_y, side_box['x']+side_box['w'], s_y)
    draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*10.5, text_h*0.8, 'ANTECEDENTES Y OBSERVACIONES', style=text_style)
    obs_words = observaciones.split(); obs_lines = []; curr = ""
    for w in obs_words:
        if len(curr)+len(w)+1 < 32: curr += (" " if curr else "")+w
        else: obs_lines.append(curr); curr = w
    if curr: obs_lines.append(curr)
    for oi, ol in enumerate(obs_lines[:6]):
        draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*8.5-oi*text_h*1.3, text_h*0.6, ol, style=text_style)

    # 6.4 Croquis de ubicación con imagen SATELITAL
    s_y -= s_unit*20
    draw_line(msp, side_box['x'], s_y, side_box['x']+side_box['w'], s_y)
    draw_line(msp, side_box['x']+side_box['w']*0.6, s_y+s_unit*20, side_box['x']+side_box['w']*0.6, s_y)
    draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*18.5, text_h*0.8, 'UBICACION LOCAL (SAT):', style=text_style)

    croq_box = {
        'x': side_box['x'] + margin,
        'y': s_y + margin,
        'w': side_box['w'] * 0.6 - margin * 2.0,
        'h': s_unit * 17.0
    }

    # Escala del croquis
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

    croq_cx = croq_box['x'] + croq_box['w'] / 2.0
    croq_cy = croq_box['y'] + croq_box['h'] / 2.0 - s_unit * 0.5

    # ─── Imagen satelital (flujo independiente) ─────────────────────────────
    box_w_m = croq_box['w'] / mini_scale if mini_scale > 0 else 500.0
    box_h_m = croq_box['h'] / mini_scale if mini_scale > 0 else 400.0

    sat_img_abs = fetch_satellite_image_sat(
        cx_utm=cx_raw, cy_utm=cy_raw,
        box_w_m=box_w_m, box_h_m=box_h_m,
        epsg_in=epsg_in,
        output_dir=output_dir,
        stem=stem
    )
    sat_rel_name = f"sat_{stem}.png"   # nombre relativo que viajará en el ZIP

    croq_vertices = [
        (croq_cx + (p['x']-cx)*mini_scale, croq_cy + (p['y']-cy)*mini_scale)
        for p in parsed_pts
    ]

    if sat_img_abs:
        embed_satellite_relative(doc, msp, sat_img_abs, sat_rel_name, croq_box)
        # Polígono encima de la imagen (más grueso, rojo)
        msp.add_lwpolyline(croq_vertices, close=True,
                           dxfattribs={'layer': 'POLIGONO', 'const_width': poly_thickness*1.5, 'color': 1})
    else:
        # Fallback vectorial si no hay imagen
        msp.add_lwpolyline(croq_vertices, close=True,
                           dxfattribs={'layer': 'POLIGONO', 'const_width': poly_thickness*0.5})
        if data_w*mini_scale < text_h*3 and data_h*mini_scale < text_h*3:
            draw_circle(msp, croq_cx, croq_cy, text_h*1.5, layer='POLIGONO')
        draw_line(msp, croq_cx-text_h*2.5, croq_cy, croq_cx+text_h*2.5, croq_cy, layer='GRILLA')
        draw_line(msp, croq_cx, croq_cy-text_h*2.5, croq_cx, croq_cy+text_h*2.5, layer='GRILLA')

    draw_centered_text(msp, croq_cx, s_y+s_unit*17.0, text_h*0.9, 'CROQUIS DE UBICACION', style=text_style)
    draw_centered_text(msp, croq_cx, s_y+s_unit*15.5, text_h*0.7, f"ESC. 1:{int(croq_scale_val)}", style=text_style)

    # Zonificación
    draw_line(msp, side_box['x']+side_box['w']*0.6, s_y+s_unit*17, side_box['x']+side_box['w'], s_y+s_unit*17)
    draw_left_text(msp, side_box['x']+side_box['w']*0.62, s_y+s_unit*18-text_h*0.35, text_h*0.75, 'ZONIFICACION', style=text_style)
    draw_left_text(msp, side_box['x']+side_box['w']*0.62, s_y+s_unit*15-text_h*0.35, text_h*0.65, f"ZONA: {zona}", style=text_style)
    draw_left_text(msp, side_box['x']+side_box['w']*0.62, s_y+s_unit*13.5-text_h*0.35, text_h*0.65, f"SECCION: {seccion}", style=text_style)
    draw_left_text(msp, side_box['x']+side_box['w']*0.62, s_y+s_unit*12-text_h*0.35, text_h*0.65, f"CATASTRAL: {cedula_cat}", style=text_style)
    draw_compass_rose(msp, side_box['x']+side_box['w']*0.8, s_y+s_unit*6, text_h*2.5, doc=doc,
                      has_template_blocks=has_template_blocks, style=text_style)

    # 6.5 Propietario
    s_y -= s_unit*9
    draw_line(msp, side_box['x'], s_y, side_box['x']+side_box['w'], s_y)
    draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*7.5, text_h*0.8, 'PROPIETARIO:', style=text_style)
    draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*6.0, text_h*0.75, propietario, style=text_style)
    draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*4.5, text_h*0.7, f"RIF: {rif}", style=text_style)
    draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*3.0, text_h*0.65, f"DIR: {domicilio}", style=text_style)

    # 6.6 Profesional
    s_y -= s_unit*9
    draw_line(msp, side_box['x'], s_y, side_box['x']+side_box['w'], s_y)
    draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*7.5, text_h*0.8, 'PROFESIONAL RESPONSABLE:', style=text_style)
    draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*6.0, text_h*0.75, profesional, style=text_style)
    draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*4.5, text_h*0.7, civ, style=text_style)

    # 6.7 Escalas / Fecha
    s_y -= s_unit*9
    draw_line(msp, side_box['x'], s_y, side_box['x']+side_box['w'], s_y)
    draw_line(msp, side_box['x']+side_box['w']*0.5, s_y+s_unit*9, side_box['x']+side_box['w']*0.5, s_y)
    fecha = datetime.date.today().strftime('%d/%m/%Y')
    draw_left_text(msp, side_box['x']+margin*0.5, s_y+s_unit*7.5, text_h*0.8, 'ESCALA DE IMPRESION:', style=text_style)
    draw_centered_text(msp, side_box['x']+side_box['w']*0.25, s_y+s_unit*5.5, text_h*0.9, f"1:{int(print_scale)}", style=text_style)
    draw_left_text(msp, side_box['x']+side_box['w']*0.52, s_y+s_unit*7.5, text_h*0.8, 'FECHA:', style=text_style)
    draw_centered_text(msp, side_box['x']+side_box['w']*0.75, s_y+s_unit*5.5, text_h*0.85, fecha, style=text_style)

    # 6.8 Firma
    s_y -= s_unit*12
    draw_line(msp, side_box['x'], s_y, side_box['x']+side_box['w'], s_y)
    cx_sign = side_box['x'] + side_box['w'] / 2
    draw_line(msp, side_box['x']+side_box['w']*0.1, s_y+s_unit*2, side_box['x']+side_box['w']*0.9, s_y+s_unit*2)
    draw_centered_text(msp, cx_sign, s_y+s_unit*1.0, text_h*0.8, 'FIRMA Y SELLO DEL PROFESIONAL', style=text_style)

    # ── Cabecera del documento (encima de todo) ──────────────────────────────
    title_y = inner['y'] + inner['h'] - table_unit * 0.5
    draw_centered_text(msp, map_box['x'] + map_box['w']/2, title_y,
                       text_h * 1.15, f"PLANO DE MENSURA  —  {project_name}", style=text_style)

    # ── Extents del documento ────────────────────────────────────────────────
    doc.header['$INSUNITS'] = 6
    ext_min = (outer['x']-margin, outer['y']-margin, 0.0)
    ext_max = (outer['x']+outer['w']+margin, outer['y']+outer['h']+margin, 0.0)
    doc.header['$EXTMIN'] = ext_min
    doc.header['$EXTMAX'] = ext_max
    doc.header['$LIMMIN'] = (ext_min[0], ext_min[1])
    doc.header['$LIMMAX'] = (ext_max[0], ext_max[1])
    doc.header['$DIMSCALE'] = print_scale

    # ── Guardar DXF ──────────────────────────────────────────────────────────
    doc.saveas(output_path)
    print(f"[SAT] DXF guardado: {output_path}", file=sys.stderr)

    # ── Empaquetar ZIP (DXF + PNG con ruta relativa) ─────────────────────────
    zip_path = output_path.replace('.dxf', '.zip')
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(output_path, arcname=Path(output_path).name)
        if sat_img_abs and os.path.exists(sat_img_abs):
            zf.write(sat_img_abs, arcname=sat_rel_name)
            print(f"[SAT] ZIP creado con imagen: {zip_path}", file=sys.stderr)
        else:
            print(f"[SAT] ZIP creado sin imagen (solo DXF): {zip_path}", file=sys.stderr)

    import gc
    gc.collect()

    print(json.dumps({
        'status': 'success',
        'file': zip_path,
        'dxf': output_path,
        'sat_image': sat_img_abs,
        'has_satellite': sat_img_abs is not None,
        'epsg_used': epsg_in,
    }))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        import traceback
        print(json.dumps({'status': 'error', 'message': str(e), 'traceback': traceback.format_exc()}))
        sys.exit(1)
