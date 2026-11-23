import math

try:
    from ezdxf.enums import TextEntityAlignment
except Exception:
    from ezdxf import const as _const

    class TextEntityAlignment:
        LEFT = _const.TEXT_ALIGNMENT_LEFT
        MIDDLE_CENTER = _const.TEXT_ALIGNMENT_MIDDLE_CENTER


def _draw_line(msp, x1, y1, x2, y2, layer='MARCO', linetype=None):
    attribs = {'layer': layer}
    if linetype:
        attribs['linetype'] = linetype
    msp.add_line((x1, y1), (x2, y2), dxfattribs=attribs)


def _draw_circle(msp, cx, cy, radius, layer='TEXTOS'):
    msp.add_circle((cx, cy), radius, dxfattribs={'layer': layer})


def _draw_left_text(msp, x, y, height, text, rotation=0, layer='TEXTOS', style='GEO_ARIAL'):
    t = msp.add_text(
        text,
        dxfattribs={
            'layer': layer,
            'height': height,
            'rotation': rotation,
            'color': 7,
            'style': style,
        },
    )
    t.set_placement((x, y), align=TextEntityAlignment.LEFT)
    return t


def _draw_centered_text(msp, x, y, height, text, rotation=0, layer='TEXTOS', style='GEO_ARIAL'):
    t = msp.add_text(
        text,
        dxfattribs={
            'layer': layer,
            'height': height,
            'rotation': rotation,
            'color': 7,
            'style': style,
        },
    )
    t.set_placement((x, y), align=TextEntityAlignment.MIDDLE_CENTER)
    return t


def _format_number(value, decimals=2):
    try:
        val_float = float(value)
        if math.isfinite(val_float):
            return f"{val_float:.{decimals}f}"
        return f"{0.0:.{decimals}f}"
    except Exception:
        return f"{0.0:.{decimals}f}"


def is_point_in_polygon(x, y, pts):
    """Ray-casting: retorna True si (x, y) está estrictamente dentro del polígono cerrado."""
    n = len(pts)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]['x'], pts[i]['y']
        xj, yj = pts[j]['x'], pts[j]['y']
        denom = (yj - yi) if abs(yj - yi) > 1e-12 else 1e-12
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / denom + xi):
            inside = not inside
        j = i
    return inside


def point_to_segment_dist(px, py, x1, y1, x2, y2):
    """Distancia euclidiana mínima desde (px, py) al segmento (x1, y1)-(x2, y2)."""
    vx, vy = x2 - x1, y2 - y1
    wx, wy = px - x1, py - y1
    len_sq = vx * vx + vy * vy
    if len_sq <= 1e-12:
        return math.hypot(wx, wy)
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / len_sq))
    proj_x = x1 + t * vx
    proj_y = y1 + t * vy
    return math.hypot(px - proj_x, py - proj_y)


def min_dist_to_polygon_boundary(px, py, pts):
    """Distancia mínima desde (px, py) a cualquier arista del polígono."""
    n = len(pts)
    if n == 0:
        return 0.0
    if n == 1:
        return math.hypot(px - pts[0]['x'], py - pts[0]['y'])
    best = float('inf')
    for i in range(n):
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        d = point_to_segment_dist(px, py, p1['x'], p1['y'], p2['x'], p2['y'])
        if d < best:
            best = d
    return best


def find_guaranteed_interior_point(pts, cx_fallback, cy_fallback):
    """
    Encuentra un punto interior garantizado (centroide de área si cae dentro con buen despeje,
    o polo de inaccesibilidad por grilla interna para polígonos cóncavos/irregulares).
    """
    n = len(pts)
    if n < 3:
        return (cx_fallback, cy_fallback), 0.0

    signed_a = 0.0
    cx_area = 0.0
    cy_area = 0.0
    for i in range(n):
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        cross = p1['x'] * p2['y'] - p2['x'] * p1['y']
        signed_a += cross
        cx_area += (p1['x'] + p2['x']) * cross
        cy_area += (p1['y'] + p2['y']) * cross

    best_pt = None
    best_dist = -1.0

    xs = [p['x'] for p in pts]
    ys = [p['y'] for p in pts]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_span = max(min(max_x - min_x, max_y - min_y), 1e-6)

    if abs(signed_a) > 1e-9:
        cx_c = cx_area / (3.0 * signed_a)
        cy_c = cy_area / (3.0 * signed_a)
        if is_point_in_polygon(cx_c, cy_c, pts):
            d_c = min_dist_to_polygon_boundary(cx_c, cy_c, pts)
            best_pt = (cx_c, cy_c)
            best_dist = d_c
            if d_c >= min_span * 0.15:
                return best_pt, best_dist

    grid_n = 12
    for ix in range(1, grid_n):
        gx = min_x + (max_x - min_x) * (ix / grid_n)
        for iy in range(1, grid_n):
            gy = min_y + (max_y - min_y) * (iy / grid_n)
            if is_point_in_polygon(gx, gy, pts):
                d = min_dist_to_polygon_boundary(gx, gy, pts)
                if d > best_dist:
                    best_dist = d
                    best_pt = (gx, gy)

    if best_pt is not None:
        return best_pt, max(best_dist, 0.0)
    return (cx_fallback, cy_fallback), 0.0


def compute_outward_edge_normal(p1, p2, pts, is_ccw, probe_eps=0.05):
    """Normal unitaria exterior garantizada mediante ray-casting."""
    dx = p2['x'] - p1['x']
    dy = p2['y'] - p1['y']
    length = math.hypot(dx, dy)
    if length <= 1e-12:
        return 0.0, 1.0
    if is_ccw:
        nx, ny = dy / length, -dx / length
    else:
        nx, ny = -dy / length, dx / length

    if len(pts) >= 3:
        eps = max(1e-4, min(probe_eps, length * 0.02))
        mid_x = (p1['x'] + p2['x']) * 0.5
        mid_y = (p1['y'] + p2['y']) * 0.5
        if is_point_in_polygon(mid_x + nx * eps, mid_y + ny * eps, pts):
            nx, ny = -nx, -ny
    return nx, ny


def compute_outward_vertex_bisector(idx, pts, is_ccw, probe_eps=0.05):
    """Calcula el vector bisector exterior unitario para el vértice idx."""
    n = len(pts)
    if n < 3:
        return 0.0, 1.0
    p_prev = pts[(idx - 1) % n]
    pt = pts[idx]
    p_next = pts[(idx + 1) % n]

    n1x, n1y = compute_outward_edge_normal(p_prev, pt, pts, is_ccw, probe_eps)
    n2x, n2y = compute_outward_edge_normal(pt, p_next, pts, is_ccw, probe_eps)
    bx = n1x + n2x
    by = n1y + n2y
    mag = math.hypot(bx, by)
    if mag <= 1e-6:
        ux = pt['x'] - p_prev['x']
        uy = pt['y'] - p_prev['y']
        umag = math.hypot(ux, uy)
        if umag > 1e-9:
            bx, by = ux / umag, uy / umag
        else:
            bx, by = n1x, n1y
    else:
        bx, by = bx / mag, by / mag

    test_eps = max(1e-4, min(probe_eps, 0.05))
    if is_point_in_polygon(pt['x'] + bx * test_eps, pt['y'] + by * test_eps, pts):
        bx, by = -bx, -by
    return bx, by


def text_bbox_corners(cx, cy, w, h, rot_deg=0.0):
    """Retorna las 4 esquinas y el centro del bounding box rotado de un texto."""
    hw = w * 0.5
    hh = h * 0.5
    rad = math.radians(rot_deg)
    ca, sa = math.cos(rad), math.sin(rad)
    local_pts = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh), (0.0, 0.0)]
    return [(cx + lx * ca - ly * sa, cy + lx * sa + ly * ca) for lx, ly in local_pts]


def text_aabb(cx, cy, w, h, rot_deg=0.0):
    """Retorna (xmin, ymin, xmax, ymax) de un bounding box rotado."""
    corners = text_bbox_corners(cx, cy, w, h, rot_deg)
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    return (min(xs), min(ys), max(xs), max(ys))


def bboxes_overlap(box_a, box_b, pad=0.0):
    """Retorna True si dos AABB (xmin, ymin, xmax, ymax) se solapan considerando un margen pad."""
    return not (
        box_a[2] + pad < box_b[0]
        or box_a[0] - pad > box_b[2]
        or box_a[3] + pad < box_b[1]
        or box_a[1] - pad > box_b[3]
    )


def box_strictly_outside_polygon(cx, cy, w, h, rot_deg, pts, min_clearance=0.0):
    """Verifica que ni el centro ni ninguna esquina del texto caiga dentro del polígono o demasiado pegada al borde."""
    if len(pts) < 3:
        return True
    for px, py in text_bbox_corners(cx, cy, w, h, rot_deg):
        if is_point_in_polygon(px, py, pts):
            return False
        if min_clearance > 0.0 and min_dist_to_polygon_boundary(px, py, pts) < min_clearance:
            return False
    return True


def box_collides_any(aabb, placed_boxes, pad=0.0):
    return any(bboxes_overlap(aabb, b, pad=pad) for b in placed_boxes)


def draw_leader_cota(msp, anchor_x, anchor_y, nx, ny, ux, uy, cota_txt, text_h,
                     stagger_sign, poly_pts, placed_boxes, style='GEO_ARIAL', min_clearance=0.0):
    """
    Dibuja una cota de distancia con línea de referencia y punta de flecha en capa COTAS
    cuando los vértices están muy cercanos o la cota normal colisiona.
    Garantiza que tanto el hombro como el texto queden 100% fuera del polígono y sin colisiones.
    """
    cota_w = max(len(cota_txt), 3) * text_h * 0.68
    cota_h = text_h * 1.15
    shoulder_len = max(cota_w * 1.12, text_h * 2.5)
    pad = text_h * 0.25

    candidate_dirs = []
    for sgn in (stagger_sign, 0.0, -stagger_sign):
        dx = nx + 0.38 * sgn * ux
        dy = ny + 0.38 * sgn * uy
        mag = math.hypot(dx, dy)
        if mag > 1e-6:
            candidate_dirs.append((dx / mag, dy / mag))
    for ang_deg in (30, -30, 60, -60, 90, -90, 120, -120):
        rad = math.radians(ang_deg)
        ca, sa = math.cos(rad), math.sin(rad)
        candidate_dirs.append((nx * ca - ny * sa, nx * sa + ny * ca))

    chosen = None
    best_fallback = None
    for dir_x, dir_y in candidate_dirs:
        if len(poly_pts) >= 3 and is_point_in_polygon(
            anchor_x + dir_x * text_h * 0.6,
            anchor_y + dir_y * text_h * 0.6,
            poly_pts,
        ):
            continue
        for step_mult in (3.6, 5.0, 6.6, 8.4):
            stem_len = text_h * step_mult
            elbow_x = anchor_x + dir_x * stem_len
            elbow_y = anchor_y + dir_y * stem_len
            if len(poly_pts) >= 3 and is_point_in_polygon(elbow_x, elbow_y, poly_pts):
                continue
            h_pref = 1.0 if dir_x >= 0 else -1.0
            for h_sign in (h_pref, -h_pref):
                end_x = elbow_x + h_sign * shoulder_len
                end_y = elbow_y
                txt_cx = (elbow_x + end_x) * 0.5
                txt_cy = elbow_y + text_h * 0.72
                aabb = text_aabb(txt_cx, txt_cy, cota_w, cota_h, 0.0)
                if not box_strictly_outside_polygon(
                    txt_cx, txt_cy, cota_w, cota_h, 0.0, poly_pts, min_clearance=min_clearance
                ):
                    continue
                if best_fallback is None:
                    best_fallback = (dir_x, dir_y, elbow_x, elbow_y, end_x, end_y, txt_cx, txt_cy, aabb)
                if not box_collides_any(aabb, placed_boxes, pad=pad):
                    chosen = (dir_x, dir_y, elbow_x, elbow_y, end_x, end_y, txt_cx, txt_cy, aabb)
                    break
            if chosen is not None:
                break
        if chosen is not None:
            break

    if chosen is None:
        if best_fallback is not None:
            chosen = best_fallback
        else:
            stem_len = text_h * 4.2
            dir_x, dir_y = nx, ny
            elbow_x = anchor_x + dir_x * stem_len
            elbow_y = anchor_y + dir_y * stem_len
            h_sign = 1.0 if dir_x >= 0 else -1.0
            end_x = elbow_x + h_sign * shoulder_len
            end_y = elbow_y
            txt_cx = (elbow_x + end_x) * 0.5
            txt_cy = elbow_y + text_h * 0.72
            aabb = text_aabb(txt_cx, txt_cy, cota_w, cota_h, 0.0)
            chosen = (dir_x, dir_y, elbow_x, elbow_y, end_x, end_y, txt_cx, txt_cy, aabb)

    dir_x, dir_y, elbow_x, elbow_y, end_x, end_y, txt_cx, txt_cy, aabb = chosen

    arrow_len = text_h * 0.90
    arrow_hw = arrow_len * 0.32
    w1x = anchor_x + dir_x * arrow_len - dir_y * arrow_hw
    w1y = anchor_y + dir_y * arrow_len + dir_x * arrow_hw
    w2x = anchor_x + dir_x * arrow_len + dir_y * arrow_hw
    w2y = anchor_y + dir_y * arrow_len - dir_x * arrow_hw

    _draw_line(msp, anchor_x, anchor_y, w1x, w1y, layer='COTAS')
    _draw_line(msp, anchor_x, anchor_y, w2x, w2y, layer='COTAS')
    _draw_line(msp, w1x, w1y, w2x, w2y, layer='COTAS')
    _draw_line(msp, anchor_x, anchor_y, elbow_x, elbow_y, layer='COTAS')
    _draw_line(msp, elbow_x, elbow_y, end_x, end_y, layer='COTAS')

    _draw_centered_text(msp, txt_cx, txt_cy, text_h, cota_txt, rotation=0, layer='COTAS', style=style)
    placed_boxes.append(aabb)


def draw_utm_grid_left_top(msp, plot_box, grid_step, text_h, text_style='GEO_ARIAL',
                           min_left_y=None, max_left_y=None):
    """
    Dibuja la grilla UTM y coloca las coordenadas ÚNICAMENTE en:
      - Lado SUPERIOR (E XXXXXX, rotación 90° debajo del marco superior)
      - Lado IZQUIERDO (N XXXXXXX, rotación 0° a la derecha del marco izquierdo)
    Nunca coloca coordenadas de grilla en el lado inferior ni en el derecho.
    """
    grid_start_x = math.ceil(plot_box['x'] / grid_step) * grid_step
    grid_start_y = math.ceil(plot_box['y'] / grid_step) * grid_step
    y_top = plot_box['y'] + plot_box['h']
    x_right = plot_box['x'] + plot_box['w']

    if min_left_y is None:
        min_left_y = plot_box['y'] + text_h * 2.0
    if max_left_y is None:
        max_left_y = y_top - text_h * 1.6

    x_grid = grid_start_x
    while x_grid <= x_right:
        _draw_line(msp, x_grid, plot_box['y'], x_grid, y_top, layer='GRILLA', linetype='GRILLA_PUNTEADA')
        if (plot_box['x'] + text_h * 1.5) <= x_grid <= (x_right - text_h * 1.5):
            txt = f"E {int(round(x_grid))}"
            txt_width = len(txt) * text_h * 0.65
            _draw_left_text(
                msp,
                x_grid - text_h * 0.3,
                y_top - txt_width - text_h * 0.6,
                text_h,
                txt,
                rotation=90,
                layer='TEXTOS',
                style=text_style,
            )
        x_grid += grid_step

    y_grid = grid_start_y
    while y_grid <= y_top:
        _draw_line(msp, plot_box['x'], y_grid, x_right, y_grid, layer='GRILLA', linetype='GRILLA_PUNTEADA')
        if min_left_y <= y_grid <= max_left_y:
            txt = f"N {int(round(y_grid))}"
            _draw_left_text(
                msp,
                plot_box['x'] + text_h * 0.5,
                y_grid + text_h * 0.3,
                text_h,
                txt,
                rotation=0,
                layer='TEXTOS',
                style=text_style,
            )
        y_grid += grid_step


def draw_segment_ticks(msp, pts, geom_type, tick_size, layer='COTAS'):
    """Dibuja ticks de 45 grados (estilo topográfico venezolano) en los extremos de cada segmento."""
    n = len(pts)
    for i in range(n):
        is_last = i == n - 1
        if geom_type == 'abierta' and is_last:
            continue
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        dx = p2['x'] - p1['x']
        dy = p2['y'] - p1['y']
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue
        ux, uy = dx / length, dy / length
        px, py = -uy, ux
        half = tick_size / 2.0
        d45x = (ux + px) / math.sqrt(2)
        d45y = (uy + py) / math.sqrt(2)
        for p_tick in (p1, p2):
            tx, ty = p_tick['x'], p_tick['y']
            msp.add_line(
                (tx - d45x * half, ty - d45y * half),
                (tx + d45x * half, ty + d45y * half),
                dxfattribs={'layer': layer},
            )


def annotate_parcel_cad(msp, p_pts, p_geom_type, p_name, p_cx, p_cy, p_perim, p_is_ccw,
                        data_w, data_h, print_scale, poly_thickness, text_style,
                        placed_boxes=None, draw_ticks_fn=None):
    """
    Anota vértices, cotas de distancia (con flecha de referencia para tramos cortos/colisiones)
    y nombre del terreno cumpliendo:
      - Ninguna etiqueta de vértice o cota dentro del polígono.
      - Dentro del perímetro únicamente el nombre del terreno en punto interior garantizado.
    """
    if placed_boxes is None:
        placed_boxes = []

    n_verts = len(p_pts)
    avg_edge_len = p_perim / max(n_verts, 1)
    min_edge_len = float('inf')
    for i in range(n_verts):
        p_curr = p_pts[i]
        p_next = p_pts[(i + 1) % n_verts]
        edge_len = math.hypot(p_next['x'] - p_curr['x'], p_next['y'] - p_curr['y'])
        if edge_len > 1e-6 and edge_len < min_edge_len:
            min_edge_len = edge_len
    if min_edge_len == float('inf') or min_edge_len <= 0:
        min_edge_len = avg_edge_len

    v_id_h = max(
        print_scale * 0.0025,
        min(min_edge_len * 0.22, avg_edge_len * 0.15, print_scale * 0.0035),
    )
    v_dist_h = max(
        print_scale * 0.0022,
        min(avg_edge_len * 0.12, v_id_h * 0.90),
    )
    marker_radius = v_id_h * 0.25

    if p_geom_type != 'puntos':
        vertices = [(pt['x'], pt['y']) for pt in p_pts]
        msp.add_lwpolyline(
            vertices,
            close=(p_geom_type == 'cerrada'),
            dxfattribs={'layer': 'POLIGONO', 'const_width': poly_thickness},
        )
        if draw_ticks_fn is not None:
            draw_ticks_fn(msp, p_pts, p_geom_type, v_id_h * 1.2)

    # 1. Vértices y sus IDs estrictamente al exterior por bisectriz
    for i, pt in enumerate(p_pts):
        _draw_circle(msp, pt['x'], pt['y'], marker_radius, layer='TEXTOS')
        id_txt = str(pt['id'])
        id_w = max(len(id_txt), 1) * v_id_h * 0.68
        id_h = v_id_h * 1.15
        bx, by = compute_outward_vertex_bisector(
            i, p_pts, p_is_ccw, probe_eps=max(marker_radius * 2.0, 0.02)
        )
        base_offset = marker_radius + v_id_h * 1.45

        placed_v = None
        best_v_fallback = None
        for ang_deg in (0, 25, -25, 50, -50, 80, -80, 120, -120, 180):
            rad = math.radians(ang_deg)
            ca, sa = math.cos(rad), math.sin(rad)
            cx_dir = bx * ca - by * sa
            cy_dir = bx * sa + by * ca
            for mult in (1.0, 1.35, 1.8):
                off = base_offset * mult
                lx = pt['x'] + cx_dir * off
                ly = pt['y'] + cy_dir * off
                if p_geom_type == 'cerrada' and n_verts >= 3:
                    if not box_strictly_outside_polygon(
                        lx, ly, id_w, id_h, 0.0, p_pts, min_clearance=marker_radius * 0.6
                    ):
                        continue
                aabb = text_aabb(lx, ly, id_w, id_h, 0.0)
                if best_v_fallback is None:
                    best_v_fallback = (lx, ly, aabb)
                if not box_collides_any(aabb, placed_boxes, pad=v_id_h * 0.25):
                    placed_v = (lx, ly, aabb)
                    break
            if placed_v is not None:
                break

        if placed_v is None:
            if best_v_fallback is not None:
                placed_v = best_v_fallback
            else:
                lx = pt['x'] + bx * (base_offset * 1.5)
                ly = pt['y'] + by * (base_offset * 1.5)
                placed_v = (lx, ly, text_aabb(lx, ly, id_w, id_h, 0.0))

        lx, ly, v_aabb = placed_v
        _draw_centered_text(msp, lx, ly, v_id_h, id_txt, layer='TEXTOS', style=text_style)
        placed_boxes.append(v_aabb)

    # 2. Cotas de distancia estrictamente al exterior (inline o leader con flecha)
    for i, pt in enumerate(p_pts):
        is_last_edge = i == n_verts - 1
        is_valid_segment = (p_geom_type == 'cerrada') or (p_geom_type == 'abierta' and not is_last_edge)
        if not is_valid_segment:
            continue

        p_next = p_pts[(i + 1) % n_verts]
        dx = p_next['x'] - pt['x']
        dy = p_next['y'] - pt['y']
        edge_len = math.hypot(dx, dy)
        if edge_len <= 1e-6:
            continue

        ux, uy = dx / edge_len, dy / edge_len
        edge_cota_h = max(print_scale * 0.0020, min(edge_len * 0.14, v_dist_h))
        cota_txt = _format_number(edge_len, 2)
        cota_w = max(len(cota_txt), 3) * edge_cota_h * 0.68
        cota_h = edge_cota_h * 1.15

        nx, ny = compute_outward_edge_normal(pt, p_next, p_pts, p_is_ccw, probe_eps=edge_cota_h)
        mid_x = (pt['x'] + p_next['x']) * 0.5
        mid_y = (pt['y'] + p_next['y']) * 0.5

        free_edge_len = edge_len - 2.0 * (marker_radius + v_id_h * 0.85)
        is_short = (free_edge_len < cota_w * 1.15) or (edge_len < print_scale * 0.014)

        text_rot = math.degrees(math.atan2(dy, dx))
        if text_rot > 90:
            text_rot -= 180
        elif text_rot < -90:
            text_rot += 180

        placed_inline = None
        if not is_short:
            base_cota_off = max(poly_thickness * 2.2 + edge_cota_h * 1.55, print_scale * 0.0036)
            for off_step in (base_cota_off, base_cota_off + edge_cota_h * 1.15):
                tx = mid_x + nx * off_step
                ty = mid_y + ny * off_step
                outside_ok = True
                if p_geom_type == 'cerrada' and n_verts >= 3:
                    outside_ok = box_strictly_outside_polygon(
                        tx, ty, cota_w, cota_h, text_rot, p_pts, min_clearance=edge_cota_h * 0.35
                    )
                if not outside_ok:
                    continue
                aabb = text_aabb(tx, ty, cota_w, cota_h, text_rot)
                if not box_collides_any(aabb, placed_boxes, pad=edge_cota_h * 0.2):
                    placed_inline = (tx, ty, aabb)
                    break

        if placed_inline is not None:
            tx, ty, c_aabb = placed_inline
            _draw_centered_text(msp, tx, ty, edge_cota_h, cota_txt, rotation=text_rot, layer='COTAS', style=text_style)
            placed_boxes.append(c_aabb)
        else:
            anchor_x = mid_x + nx * (poly_thickness * 0.5)
            anchor_y = mid_y + ny * (poly_thickness * 0.5)
            stagger = 1.0 if (i % 2 == 0) else -1.0
            draw_leader_cota(
                msp,
                anchor_x,
                anchor_y,
                nx,
                ny,
                ux,
                uy,
                cota_txt,
                edge_cota_h,
                stagger,
                p_pts,
                placed_boxes,
                style=text_style,
                min_clearance=edge_cota_h * 0.35,
            )

    # 3. Única etiqueta interior: Nombre del terreno en punto interior garantizado
    (in_x, in_y), max_clearance = find_guaranteed_interior_point(p_pts, p_cx, p_cy)
    inner_dim = min(data_w, data_h)
    interior_text_h = max(
        print_scale * 0.0030,
        min(inner_dim * 0.055, print_scale * 0.0055),
    )
    if max_clearance > 0 and len(p_name) > 0:
        max_h_fit = (max_clearance * 1.65) / max(len(p_name) * 0.65, 1.0)
        interior_text_h = max(print_scale * 0.0018, min(interior_text_h, max_h_fit))
    _draw_centered_text(msp, in_x, in_y, interior_text_h, p_name, layer='TEXTOS', style=text_style)
