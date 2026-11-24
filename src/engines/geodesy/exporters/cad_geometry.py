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


def normalize_vertex_id(raw_id, fallback_idx):
    """Formatea el identificador de vértice según norma topográfica (P1, P2, ...)."""
    s = str(raw_id or '').strip().upper()
    if not s:
        return f"P{fallback_idx}"
    if s.isdigit():
        return f"P{s}"
    return s


def obb_corners(cx, cy, w, h, rot_deg=0.0):
    """Retorna las 4 esquinas del rectángulo orientado (OBB) de un texto."""
    hw = w * 0.5
    hh = h * 0.5
    rad = math.radians(rot_deg)
    ca, sa = math.cos(rad), math.sin(rad)
    local_pts = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    return [(cx + lx * ca - ly * sa, cy + lx * sa + ly * ca) for lx, ly in local_pts]


def text_bbox_corners(cx, cy, w, h, rot_deg=0.0):
    """Retorna las 4 esquinas y el centro del bounding box rotado de un texto."""
    return obb_corners(cx, cy, w, h, rot_deg) + [(cx, cy)]


def text_aabb(cx, cy, w, h, rot_deg=0.0):
    """Retorna (xmin, ymin, xmax, ymax) de un bounding box rotado."""
    corners = obb_corners(cx, cy, w, h, rot_deg)
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


def _aabb_to_obb(aabb):
    xmin, ymin, xmax, ymax = aabb
    return [(xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax)]


def obbs_overlap(corners_a, corners_b, pad=0.0):
    """Test SAT 2D (Separating Axis Theorem) entre dos rectángulos orientados con margen pad."""
    axes = []
    for corners in (corners_a, corners_b):
        for i in range(2):
            p1 = corners[i]
            p2 = corners[(i + 1) % 4]
            ex, ey = p2[0] - p1[0], p2[1] - p1[1]
            mag = math.hypot(ex, ey)
            if mag > 1e-12:
                axes.append((-ey / mag, ex / mag))
    for ax, ay in axes:
        pa = [p[0] * ax + p[1] * ay for p in corners_a]
        pb = [p[0] * ax + p[1] * ay for p in corners_b]
        if max(pa) + pad < min(pb) or max(pb) + pad < min(pa):
            return False
    return True


def _seg_to_seg_dist(ax, ay, bx, by, cx, cy, dx, dy):
    """Distancia euclidiana mínima entre dos segmentos 2D."""
    return min(
        point_to_segment_dist(ax, ay, cx, cy, dx, dy),
        point_to_segment_dist(bx, by, cx, cy, dx, dy),
        point_to_segment_dist(cx, cy, ax, ay, bx, by),
        point_to_segment_dist(dx, dy, ax, ay, bx, by),
    )


def segments_intersect(ax, ay, bx, by, cx, cy, dx, dy, clearance=0.0, allow_shared_endpoint_tol=0.0):
    """Retorna True si los segmentos AB y CD se cruzan o quedan más cerca que clearance."""
    def _ccw(p1x, p1y, p2x, p2y, p3x, p3y):
        return (p2x - p1x) * (p3y - p1y) - (p2y - p1y) * (p3x - p1x)

    if max(ax, bx) + clearance < min(cx, dx) or max(cx, dx) + clearance < min(ax, bx):
        return False
    if max(ay, by) + clearance < min(cy, dy) or max(cy, dy) + clearance < min(ay, by):
        return False

    d1 = _ccw(cx, cy, dx, dy, ax, ay)
    d2 = _ccw(cx, cy, dx, dy, bx, by)
    d3 = _ccw(ax, ay, bx, by, cx, cy)
    d4 = _ccw(ax, ay, bx, by, dx, dy)

    proper = ((d1 > 1e-9 and d2 < -1e-9) or (d1 < -1e-9 and d2 > 1e-9)) and (
        (d3 > 1e-9 and d4 < -1e-9) or (d3 < -1e-9 and d4 > 1e-9)
    )
    if proper:
        return True

    # Colinear / toque en extremo
    if abs(d1) <= 1e-9 and point_to_segment_dist(ax, ay, cx, cy, dx, dy) <= 1e-6:
        if allow_shared_endpoint_tol <= 0 or math.hypot(ax - cx, ay - cy) > allow_shared_endpoint_tol and math.hypot(ax - dx, ay - dy) > allow_shared_endpoint_tol:
            return True
    if abs(d2) <= 1e-9 and point_to_segment_dist(bx, by, cx, cy, dx, dy) <= 1e-6:
        if allow_shared_endpoint_tol <= 0 or math.hypot(bx - cx, by - cy) > allow_shared_endpoint_tol and math.hypot(bx - dx, by - dy) > allow_shared_endpoint_tol:
            return True

    if clearance > 0.0:
        return _seg_to_seg_dist(ax, ay, bx, by, cx, cy, dx, dy) < clearance
    return False


def _point_in_obb(px, py, corners, pad=0.0):
    p0, p1, _, p3 = corners
    ux, uy = p1[0] - p0[0], p1[1] - p0[1]
    vx, vy = p3[0] - p0[0], p3[1] - p0[1]
    u_len = math.hypot(ux, uy)
    v_len = math.hypot(vx, vy)
    if u_len <= 1e-9 or v_len <= 1e-9:
        return False
    ux, uy = ux / u_len, uy / u_len
    vx, vy = vx / v_len, vy / v_len
    du = (px - p0[0]) * ux + (py - p0[1]) * uy
    dv = (px - p0[0]) * vx + (py - p0[1]) * vy
    return (-pad <= du <= u_len + pad) and (-pad <= dv <= v_len + pad)


def segment_intersects_obb(x1, y1, x2, y2, corners, pad=0.0):
    """Retorna True si el segmento (x1,y1)-(x2,y2) atraviesa o toca el OBB (con margen pad)."""
    if _point_in_obb(x1, y1, corners, pad=pad) or _point_in_obb(x2, y2, corners, pad=pad):
        return True
    for i in range(4):
        c1 = corners[i]
        c2 = corners[(i + 1) % 4]
        if segments_intersect(x1, y1, x2, y2, c1[0], c1[1], c2[0], c2[1], clearance=pad):
            return True
    return False


def segment_crosses_polygon_edges(x1, y1, x2, y2, pts, ignore_edge_idx=None, ignore_vertex_idx=None, poly_edge_aabbs=None):
    """Retorna True si el segmento (x1,y1)-(x2,y2) cruza alguna arista del polígono cerrado."""
    n = len(pts)
    if n < 2:
        return False
    sminx = x1 if x1 < x2 else x2
    smaxx = x2 if x1 < x2 else x1
    sminy = y1 if y1 < y2 else y2
    smaxy = y2 if y1 < y2 else y1
    for j in range(n):
        if ignore_edge_idx is not None and j == ignore_edge_idx:
            continue
        if ignore_vertex_idx is not None and (j == ignore_vertex_idx or (j + 1) % n == ignore_vertex_idx):
            continue
        if poly_edge_aabbs is not None:
            ex0, ey0, ex1, ey1 = poly_edge_aabbs[j]
            if smaxx < ex0 or sminx > ex1 or smaxy < ey0 or sminy > ey1:
                continue
        p1 = pts[j]
        p2 = pts[(j + 1) % n]
        if segments_intersect(x1, y1, x2, y2, p1['x'], p1['y'], p2['x'], p2['y'], clearance=0.0):
            return True
    return False


def box_strictly_outside_polygon(cx, cy, w, h, rot_deg, pts, min_clearance=0.0, poly_aabb=None):
    """Verifica que ni el centro ni ninguna esquina del texto caiga dentro del polígono o demasiado pegada al borde."""
    if len(pts) < 3:
        return True
    if poly_aabb is not None:
        b_aabb = text_aabb(cx, cy, w, h, rot_deg)
        if (
            b_aabb[2] + min_clearance < poly_aabb[0]
            or b_aabb[0] - min_clearance > poly_aabb[2]
            or b_aabb[3] + min_clearance < poly_aabb[1]
            or b_aabb[1] - min_clearance > poly_aabb[3]
        ):
            return True
    for px, py in text_bbox_corners(cx, cy, w, h, rot_deg):
        if is_point_in_polygon(px, py, pts):
            return False
        if min_clearance > 0.0 and min_dist_to_polygon_boundary(px, py, pts) < min_clearance:
            return False
    return True


def box_collides_any(aabb, placed_boxes, pad=0.0):
    return any(bboxes_overlap(aabb, b, pad=pad) for b in placed_boxes)


def obb_collides_any(obb, placed_obbs, pad=0.0, obb_aabb=None, placed_aabbs=None):
    if placed_aabbs is not None and obb_aabb is not None:
        for idx, b_obb in enumerate(placed_obbs):
            if not bboxes_overlap(obb_aabb, placed_aabbs[idx], pad=pad):
                continue
            if obbs_overlap(obb, b_obb, pad=pad):
                return True
        return False
    return any(obbs_overlap(obb, b, pad=pad) for b in placed_obbs)


def draw_leader_cota(msp, p1, p2, nx, ny, ux, uy, poly_thickness, cota_txt, text_h,
                     stagger_sign, poly_pts, placed_obbs, placed_leader_segments,
                     edge_idx=None, placed_boxes=None, style='GEO_ARIAL', min_clearance=0.0,
                     placed_aabbs=None, placed_leader_aabbs=None, poly_aabb=None, poly_edge_aabbs=None):
    """
    Dibuja una cota de distancia con línea de referencia y punta de flecha en capa COTAS
    garantizando cero cruces entre flechas, cero cruces con el polígono y sin atravesar etiquetas.
    """
    cota_w = max(len(cota_txt), 3) * text_h * 0.66
    cota_h = text_h * 1.15
    shoulder_len = max(cota_w * 1.04, text_h * 1.75)
    pad = text_h * 0.25
    line_clear = text_h * 0.35

    candidate_dirs = []
    base_angles = (0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75)
    if stagger_sign < 0:
        base_angles = (0, -15, 15, -30, 30, -45, 45, -60, 60, -75, 75)
    for ang_deg in base_angles:
        rad = math.radians(ang_deg)
        ca, sa = math.cos(rad), math.sin(rad)
        candidate_dirs.append((nx * ca - ny * sa, nx * sa + ny * ca))

    chosen = None
    best_fallback = None
    best_penalty = float('inf')

    dense_mode = len(poly_pts) > 45
    step_mults = (1.8, 2.7, 3.8, 5.2) if dense_mode else (1.8, 2.5, 3.4, 4.5, 5.8, 7.2)
    t_anchors = (0.5, 0.35) if dense_mode else (0.5, 0.35, 0.65)
    if placed_aabbs is None:
        placed_aabbs = [
            (min(c[0] for c in b), min(c[1] for c in b), max(c[0] for c in b), max(c[1] for c in b))
            for b in placed_obbs
        ]
    if placed_leader_aabbs is None:
        placed_leader_aabbs = [
            (min(s[0], s[2]), min(s[1], s[3]), max(s[0], s[2]), max(s[1], s[3]))
            for s in placed_leader_segments
        ]

    for step_mult in step_mults:
        stem_len = text_h * step_mult
        for ang_idx, (dir_x, dir_y) in enumerate(candidate_dirs):
            for t_anchor in t_anchors:
                base_x = p1['x'] + (p2['x'] - p1['x']) * t_anchor
                base_y = p1['y'] + (p2['y'] - p1['y']) * t_anchor
                anchor_x = base_x + nx * (poly_thickness * 0.5)
                anchor_y = base_y + ny * (poly_thickness * 0.5)

                if len(poly_pts) >= 3 and is_point_in_polygon(
                    anchor_x + dir_x * text_h * 0.6,
                    anchor_y + dir_y * text_h * 0.6,
                    poly_pts,
                ):
                    continue

                elbow_x = anchor_x + dir_x * stem_len
                elbow_y = anchor_y + dir_y * stem_len
                if len(poly_pts) >= 3 and is_point_in_polygon(elbow_x, elbow_y, poly_pts):
                    continue
                if len(poly_pts) >= 3 and segment_crosses_polygon_edges(
                    anchor_x + dir_x * text_h * 0.25,
                    anchor_y + dir_y * text_h * 0.25,
                    elbow_x,
                    elbow_y,
                    poly_pts,
                    ignore_edge_idx=edge_idx,
                    poly_edge_aabbs=poly_edge_aabbs,
                ):
                    continue

                st_minx = min(anchor_x, elbow_x) - line_clear
                st_maxx = max(anchor_x, elbow_x) + line_clear
                st_miny = min(anchor_y, elbow_y) - line_clear
                st_maxy = max(anchor_y, elbow_y) + line_clear

                stem_leader_cross = 0
                for idx_l, (lx1, ly1, lx2, ly2) in enumerate(placed_leader_segments):
                    la = placed_leader_aabbs[idx_l]
                    if st_maxx < la[0] or st_minx > la[2] or st_maxy < la[1] or st_miny > la[3]:
                        continue
                    if segments_intersect(anchor_x, anchor_y, elbow_x, elbow_y, lx1, ly1, lx2, ly2, clearance=line_clear):
                        stem_leader_cross += 1
                        break

                stem_obb_pierce = 0
                for idx_o, other_obb in enumerate(placed_obbs):
                    oa = placed_aabbs[idx_o]
                    if st_maxx < oa[0] or st_minx > oa[2] or st_maxy < oa[1] or st_miny > oa[3]:
                        continue
                    if segment_intersects_obb(anchor_x, anchor_y, elbow_x, elbow_y, other_obb, pad=pad * 0.5):
                        stem_obb_pierce += 1
                        break

                h_pref = 1.0 if dir_x >= 0 else -1.0
                for h_sign in (h_pref, -h_pref):
                    end_x = elbow_x + h_sign * shoulder_len
                    end_y = elbow_y
                    if len(poly_pts) >= 3 and is_point_in_polygon(end_x, end_y, poly_pts):
                        continue
                    if len(poly_pts) >= 3 and segment_crosses_polygon_edges(
                        elbow_x, elbow_y, end_x, end_y, poly_pts, poly_edge_aabbs=poly_edge_aabbs
                    ):
                        continue

                    txt_cx = (elbow_x + end_x) * 0.5
                    txt_cy = elbow_y + text_h * 0.72
                    if not box_strictly_outside_polygon(
                        txt_cx, txt_cy, cota_w, cota_h, 0.0, poly_pts, min_clearance=min_clearance, poly_aabb=poly_aabb
                    ):
                        continue

                    obb = obb_corners(txt_cx, txt_cy, cota_w, cota_h, 0.0)
                    obb_box = (txt_cx - cota_w * 0.5, txt_cy - cota_h * 0.5, txt_cx + cota_w * 0.5, txt_cy + cota_h * 0.5)
                    sh_minx = min(elbow_x, end_x) - line_clear
                    sh_maxx = max(elbow_x, end_x) + line_clear
                    sh_miny = min(elbow_y, end_y) - line_clear
                    sh_maxy = max(elbow_y, end_y) + line_clear

                    leader_crosses = stem_leader_cross
                    if leader_crosses == 0:
                        for idx_l, (lx1, ly1, lx2, ly2) in enumerate(placed_leader_segments):
                            la = placed_leader_aabbs[idx_l]
                            if not (sh_maxx < la[0] or sh_minx > la[2] or sh_maxy < la[1] or sh_miny > la[3]):
                                if segments_intersect(elbow_x, elbow_y, end_x, end_y, lx1, ly1, lx2, ly2, clearance=line_clear):
                                    leader_crosses += 1
                                    break
                            if not (obb_box[2] + pad < la[0] or obb_box[0] - pad > la[2] or obb_box[3] + pad < la[1] or obb_box[1] - pad > la[3]):
                                if segment_intersects_obb(lx1, ly1, lx2, ly2, obb, pad=pad * 0.5):
                                    leader_crosses += 1
                                    break

                    obb_pierce = stem_obb_pierce
                    if obb_pierce == 0:
                        for idx_o, other_obb in enumerate(placed_obbs):
                            oa = placed_aabbs[idx_o]
                            if sh_maxx < oa[0] or sh_minx > oa[2] or sh_maxy < oa[1] or sh_miny > oa[3]:
                                continue
                            if segment_intersects_obb(elbow_x, elbow_y, end_x, end_y, other_obb, pad=pad * 0.5):
                                obb_pierce += 1
                                break

                    box_hit = 1 if obb_collides_any(obb, placed_obbs, pad=pad, obb_aabb=obb_box, placed_aabbs=placed_aabbs) else 0
                    penalty = leader_crosses * 100.0 + obb_pierce * 10.0 + box_hit * 5.0 + step_mult * 0.1 + ang_idx * 0.05

                    cand = (anchor_x, anchor_y, dir_x, dir_y, elbow_x, elbow_y, end_x, end_y, txt_cx, txt_cy, obb, obb_box)
                    if penalty < best_penalty:
                        best_penalty = penalty
                        best_fallback = cand

                    if leader_crosses == 0 and obb_pierce == 0 and box_hit == 0:
                        chosen = cand
                        break
                if chosen is not None:
                    break
            if chosen is not None:
                break
        if chosen is not None:
            break

    if chosen is None:
        if best_fallback is not None:
            chosen = best_fallback
        else:
            anchor_x = (p1['x'] + p2['x']) * 0.5 + nx * (poly_thickness * 0.5)
            anchor_y = (p1['y'] + p2['y']) * 0.5 + ny * (poly_thickness * 0.5)
            stem_len = text_h * 3.2
            dir_x, dir_y = nx, ny
            elbow_x = anchor_x + dir_x * stem_len
            elbow_y = anchor_y + dir_y * stem_len
            h_sign = 1.0 if dir_x >= 0 else -1.0
            end_x = elbow_x + h_sign * shoulder_len
            end_y = elbow_y
            txt_cx = (elbow_x + end_x) * 0.5
            txt_cy = elbow_y + text_h * 0.72
            obb = obb_corners(txt_cx, txt_cy, cota_w, cota_h, 0.0)
            obb_box = (txt_cx - cota_w * 0.5, txt_cy - cota_h * 0.5, txt_cx + cota_w * 0.5, txt_cy + cota_h * 0.5)
            chosen = (anchor_x, anchor_y, dir_x, dir_y, elbow_x, elbow_y, end_x, end_y, txt_cx, txt_cy, obb, obb_box)

    anchor_x, anchor_y, dir_x, dir_y, elbow_x, elbow_y, end_x, end_y, txt_cx, txt_cy, obb, obb_box = chosen

    arrow_len = text_h * 0.85
    arrow_hw = arrow_len * 0.30
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
    placed_obbs.append(obb)
    placed_aabbs.append(obb_box)
    placed_leader_segments.append((anchor_x, anchor_y, elbow_x, elbow_y))
    placed_leader_aabbs.append((min(anchor_x, elbow_x), min(anchor_y, elbow_y), max(anchor_x, elbow_x), max(anchor_y, elbow_y)))
    placed_leader_segments.append((elbow_x, elbow_y, end_x, end_y))
    placed_leader_aabbs.append((min(elbow_x, end_x), min(elbow_y, end_y), max(elbow_x, end_x), max(elbow_y, end_y)))
    if placed_boxes is not None:
        placed_boxes.append(obb_box)


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
        if (plot_box['x'] + text_h * 2.2) <= x_grid <= (x_right - text_h * 2.2):
            txt = f"E {int(round(x_grid))}"
            txt_width = len(txt) * text_h * 0.85
            _draw_left_text(
                msp,
                x_grid - text_h * 0.3,
                y_top - txt_width - text_h * 2.2,
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
                plot_box['x'] + text_h * 0.8,
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

    placed_obbs = [_aabb_to_obb(b) for b in placed_boxes]
    placed_aabbs = list(placed_boxes)
    placed_leader_segments = []
    placed_leader_aabbs = []

    n_verts = len(p_pts)
    poly_aabb = None
    poly_edge_aabbs = None
    if n_verts >= 2:
        pxs = [p['x'] for p in p_pts]
        pys = [p['y'] for p in p_pts]
        poly_aabb = (min(pxs), min(pys), max(pxs), max(pys))
        poly_edge_aabbs = []
        for k in range(n_verts):
            pa = p_pts[k]
            pb = p_pts[(k + 1) % n_verts]
            poly_edge_aabbs.append((min(pa['x'], pb['x']), min(pa['y'], pb['y']), max(pa['x'], pb['x']), max(pa['y'], pb['y'])))
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
        print_scale * 0.0023,
        min(min_edge_len * 0.22, avg_edge_len * 0.15, print_scale * 0.0033),
    )
    v_dist_h = max(
        print_scale * 0.0020,
        min(avg_edge_len * 0.12, v_id_h * 0.88),
    )
    marker_radius = v_id_h * 0.24

    if p_geom_type != 'puntos':
        vertices = [(pt['x'], pt['y']) for pt in p_pts]
        msp.add_lwpolyline(
            vertices,
            close=(p_geom_type == 'cerrada'),
            dxfattribs={'layer': 'POLIGONO', 'const_width': poly_thickness},
        )
        if draw_ticks_fn is not None:
            draw_ticks_fn(msp, p_pts, p_geom_type, v_id_h * 1.15)

    # 1. Vértices y sus IDs normativos (P1, P2, ...) estrictamente al exterior por bisectriz
    for i, pt in enumerate(p_pts):
        _draw_circle(msp, pt['x'], pt['y'], marker_radius, layer='TEXTOS')
        id_txt = normalize_vertex_id(pt.get('id'), i + 1)
        id_w = max(len(id_txt), 2) * v_id_h * 0.66
        id_h = v_id_h * 1.12
        bx, by = compute_outward_vertex_bisector(
            i, p_pts, p_is_ccw, probe_eps=max(marker_radius * 2.0, 0.02)
        )
        base_offset = marker_radius + v_id_h * 1.35

        placed_v = None
        best_v_fallback = None
        for ang_deg in (0, 20, -20, 40, -40, 60, -60, 85, -85, 110, -110, 140, -140, 180):
            rad = math.radians(ang_deg)
            ca, sa = math.cos(rad), math.sin(rad)
            cx_dir = bx * ca - by * sa
            cy_dir = bx * sa + by * ca
            for mult in (1.0, 1.35, 1.75, 2.2):
                off = base_offset * mult
                lx = pt['x'] + cx_dir * off
                ly = pt['y'] + cy_dir * off
                if p_geom_type == 'cerrada' and n_verts >= 3:
                    if not box_strictly_outside_polygon(
                        lx, ly, id_w, id_h, 0.0, p_pts, min_clearance=marker_radius * 0.55, poly_aabb=poly_aabb
                    ):
                        continue
                    if segment_crosses_polygon_edges(
                        pt['x'], pt['y'], lx, ly, p_pts, ignore_vertex_idx=i, poly_edge_aabbs=poly_edge_aabbs
                    ):
                        continue
                v_obb = obb_corners(lx, ly, id_w, id_h, 0.0)
                v_aabb_cand = (lx - id_w * 0.5, ly - id_h * 0.5, lx + id_w * 0.5, ly + id_h * 0.5)
                if best_v_fallback is None:
                    best_v_fallback = (lx, ly, v_obb, v_aabb_cand)
                if not obb_collides_any(v_obb, placed_obbs, pad=v_id_h * 0.22, obb_aabb=v_aabb_cand, placed_aabbs=placed_aabbs):
                    placed_v = (lx, ly, v_obb, v_aabb_cand)
                    break
            if placed_v is not None:
                break

        if placed_v is None:
            if best_v_fallback is not None:
                placed_v = best_v_fallback
            else:
                lx = pt['x'] + bx * (base_offset * 1.5)
                ly = pt['y'] + by * (base_offset * 1.5)
                placed_v = (lx, ly, obb_corners(lx, ly, id_w, id_h, 0.0), (lx - id_w * 0.5, ly - id_h * 0.5, lx + id_w * 0.5, ly + id_h * 0.5))

        lx, ly, v_obb, v_aabb = placed_v
        _draw_centered_text(msp, lx, ly, v_id_h, id_txt, layer='TEXTOS', style=text_style)
        placed_obbs.append(v_obb)
        placed_aabbs.append(v_aabb)
        placed_boxes.append(v_aabb)

    # 2. Cotas de distancia en 2 pasadas:
    #    Pasada 2A: Todas las cotas paralelas inline primero (para no perder espacio ante flechas vecinas)
    #    Pasada 2B: Flechas de referencia (leaders anti-cruce) solo para tramos cortos o sin espacio inline
    pending_leaders = []
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
        edge_cota_h = max(print_scale * 0.0015, min(edge_len * 0.18, v_dist_h))
        cota_txt = _format_number(edge_len, 2)
        cota_w = max(len(cota_txt), 3) * edge_cota_h * 0.66
        cota_h = edge_cota_h * 1.15

        nx, ny = compute_outward_edge_normal(pt, p_next, p_pts, p_is_ccw, probe_eps=edge_cota_h)
        mid_x = (pt['x'] + p_next['x']) * 0.5
        mid_y = (pt['y'] + p_next['y']) * 0.5

        is_short = (edge_len < cota_w * 0.95) or (edge_len < print_scale * 0.0055)

        text_rot = math.degrees(math.atan2(dy, dx))
        if text_rot > 90:
            text_rot -= 180
        elif text_rot < -90:
            text_rot += 180

        placed_inline = None
        if not is_short:
            base_cota_off = max(poly_thickness * 1.6 + edge_cota_h * 1.05, print_scale * 0.0024)
            for off_mult in (0.90, 1.20, 1.55, 1.95):
                off_step = base_cota_off * off_mult
                for along_frac in (0.0, 0.14, -0.14, 0.26, -0.26):
                    anchor_px = mid_x + ux * (edge_len * along_frac)
                    anchor_py = mid_y + uy * (edge_len * along_frac)
                    tx = anchor_px + nx * off_step
                    ty = anchor_py + ny * off_step
                    if p_geom_type == 'cerrada' and n_verts >= 3:
                        if not box_strictly_outside_polygon(
                            tx, ty, cota_w, cota_h, text_rot, p_pts, min_clearance=edge_cota_h * 0.25, poly_aabb=poly_aabb
                        ):
                            continue
                        if segment_crosses_polygon_edges(
                            anchor_px + nx * (poly_thickness * 0.5),
                            anchor_py + ny * (poly_thickness * 0.5),
                            tx,
                            ty,
                            p_pts,
                            ignore_edge_idx=i,
                            poly_edge_aabbs=poly_edge_aabbs,
                        ):
                            continue
                    c_obb = obb_corners(tx, ty, cota_w, cota_h, text_rot)
                    c_aabb = text_aabb(tx, ty, cota_w, cota_h, text_rot)
                    if not obb_collides_any(c_obb, placed_obbs, pad=edge_cota_h * 0.18, obb_aabb=c_aabb, placed_aabbs=placed_aabbs):
                        placed_inline = (tx, ty, c_obb, c_aabb)
                        break
                if placed_inline is not None:
                    break

        if placed_inline is not None:
            tx, ty, c_obb, c_aabb = placed_inline
            _draw_centered_text(msp, tx, ty, edge_cota_h, cota_txt, rotation=text_rot, layer='COTAS', style=text_style)
            placed_obbs.append(c_obb)
            placed_aabbs.append(c_aabb)
            placed_boxes.append(c_aabb)
        else:
            pending_leaders.append((i, pt, p_next, nx, ny, ux, uy, cota_txt, edge_cota_h))

    for leader_idx, (i, pt, p_next, nx, ny, ux, uy, cota_txt, edge_cota_h) in enumerate(pending_leaders):
        stagger = 1.0 if (leader_idx % 2 == 0) else -1.0
        draw_leader_cota(
            msp,
            pt,
            p_next,
            nx,
            ny,
            ux,
            uy,
            poly_thickness,
            cota_txt,
            edge_cota_h,
            stagger,
            p_pts,
            placed_obbs,
            placed_leader_segments,
            edge_idx=i,
            placed_boxes=placed_boxes,
            style=text_style,
            min_clearance=edge_cota_h * 0.30,
            placed_aabbs=placed_aabbs,
            placed_leader_aabbs=placed_leader_aabbs,
            poly_aabb=poly_aabb,
            poly_edge_aabbs=poly_edge_aabbs,
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


# ══════════════════════════════════════════════════════════════════════════════
# MOTOR ADAPTATIVO DE CUADROS DE CONSTRUCCIÓN EN 3 NIVELES
# ══════════════════════════════════════════════════════════════════════════════

def _draw_rect(msp, x, y, w, h, thickness=0.0, layer='MARCO'):
    pts = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    attribs = {'layer': layer}
    if thickness > 0:
        attribs['const_width'] = thickness
    msp.add_lwpolyline(pts, close=True, dxfattribs=attribs)


def _draw_cell_text_fit(msp, x, y, text_height, col_w, text, layer='TEXTOS', style='GEO_ARIAL'):
    """Dibuja texto centrado en celda ajustando factor de ancho y altura si excede el ancho de columna."""
    txt_str = str(text)
    if not txt_str:
        return None
    h = max(text_height, 1e-4)
    est_w = max(len(txt_str), 1) * h * 0.66
    avail_w = max(col_w * 0.82, 1e-4)
    width_factor = 1.0
    if est_w > avail_w:
        width_factor = max(0.72, min(0.98, avail_w / est_w))
        if est_w * width_factor > avail_w:
            h = h * (avail_w / (est_w * width_factor))
    t = msp.add_text(
        txt_str,
        dxfattribs={
            'layer': layer,
            'height': h,
            'width': width_factor,
            'rotation': 0,
            'color': 7,
            'style': style,
        },
    )
    t.set_placement((x, y), align=TextEntityAlignment.MIDDLE_CENTER)
    return t


def _resolve_punto_apoyo(p_item, p_pts, metadata, clean_text_fn, extract_coords_fn):
    pa_custom = None
    if isinstance(metadata, dict):
        pa_custom = metadata.get('puntoApoyo')
    if pa_custom is None:
        pa_custom = p_item.get('puntoApoyo')
    if isinstance(pa_custom, dict):
        pa_id = clean_text_fn(pa_custom.get('id', 'V.P.'), 'V.P.') or 'V.P.'
        pa_x_val, pa_y_val = extract_coords_fn(pa_custom)
        pa_x = pa_x_val if pa_x_val is not None else p_pts[0]['x']
        pa_y = pa_y_val if pa_y_val is not None else p_pts[0]['y']
    else:
        pa_id = 'V.P.'
        pa_x = p_pts[0]['x']
        pa_y = p_pts[0]['y']
    return pa_id, pa_x, pa_y


def _build_unified_rows_for_parcel(p_item, get_bearing_fn, format_number_fn):
    p_pts = p_item['pts']
    p_geom = p_item.get('geometryType', 'cerrada')
    n_pts = len(p_pts)
    rows = []
    for idx, p1 in enumerate(p_pts):
        p1_lbl = normalize_vertex_id(p1.get('id'), idx + 1)
        is_last = idx == n_pts - 1
        has_next = (p_geom == 'cerrada' and n_pts >= 2) or (p_geom == 'abierta' and not is_last)
        if has_next:
            next_idx = (idx + 1) % n_pts
            p2 = p_pts[next_idx]
            p2_lbl = normalize_vertex_id(p2.get('id'), next_idx + 1)
            dx = p2['x'] - p1['x']
            dy = p2['y'] - p1['y']
            lado_str = f"{p1_lbl}-{p2_lbl}"
            rumbo_str = get_bearing_fn(dx, dy)
            dist_str = format_number_fn(math.hypot(dx, dy), 2)
        else:
            lado_str = p1_lbl
            rumbo_str = '-'
            dist_str = '-'
        rows.append(
            {
                'lado': lado_str,
                'rumbo': rumbo_str,
                'dist': dist_str,
                'vert': p1_lbl,
                'norte': format_number_fn(p1['y'], 3),
                'este': format_number_fn(p1['x'], 3),
            }
        )
    return rows


def _draw_compact_balance_and_pa(msp, box_x, top_y, box_w, hdr_h, row_h, title,
                                 area_doc_txt, area_mens_txt, pa_id, pa_x, pa_y,
                                 frame_thickness, text_h, text_style, format_number_fn):
    """Dibuja cuadro compacto Balance de Superficie + Punto de Apoyo (1 hdr + 2 rows)."""
    total_h = hdr_h + 2.0 * row_h
    _draw_rect(msp, box_x, top_y - total_h, box_w, total_h, thickness=frame_thickness * 0.5, layer='MARCO')
    _draw_line(msp, box_x, top_y - hdr_h, box_x + box_w, top_y - hdr_h, layer='MARCO')
    _draw_line(msp, box_x, top_y - hdr_h - row_h, box_x + box_w, top_y - hdr_h - row_h, layer='MARCO')

    _draw_cell_text_fit(
        msp, box_x + box_w * 0.5, top_y - hdr_h * 0.5,
        min(text_h * 0.85, hdr_h * 0.50), box_w, title, layer='TEXTOS', style=text_style
    )

    # Fila 1: Área Documento | Área Mensura
    y1 = top_y - hdr_h - row_h * 0.5
    c_mid = box_w * 0.5
    _draw_line(msp, box_x + c_mid, top_y - hdr_h, box_x + c_mid, top_y - hdr_h - row_h, layer='MARCO')
    cell_h = min(text_h * 0.88, row_h * 0.66)
    _draw_cell_text_fit(msp, box_x + c_mid * 0.5, y1, cell_h, c_mid, f"A.DOC: {area_doc_txt}", layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + c_mid * 1.5, y1, cell_h, c_mid, f"A.MENS: {area_mens_txt}", layer='TEXTOS', style=text_style)

    # Fila 2: Punto de Apoyo | N | E
    y2 = top_y - hdr_h - row_h * 1.5
    c_pa1 = box_w * 0.20
    c_pa2 = box_w * 0.40
    c_pa3 = box_w - c_pa1 - c_pa2
    _draw_line(msp, box_x + c_pa1, top_y - hdr_h - row_h, box_x + c_pa1, top_y - total_h, layer='MARCO')
    _draw_line(msp, box_x + c_pa1 + c_pa2, top_y - hdr_h - row_h, box_x + c_pa1 + c_pa2, top_y - total_h, layer='MARCO')
    _draw_cell_text_fit(msp, box_x + c_pa1 * 0.5, y2, cell_h, c_pa1, f"PA: {pa_id}", layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + c_pa1 + c_pa2 * 0.5, y2, cell_h, c_pa2, f"N:{format_number_fn(pa_y, 2)}", layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + c_pa1 + c_pa2 + c_pa3 * 0.5, y2, cell_h, c_pa3, f"E:{format_number_fn(pa_x, 2)}", layer='TEXTOS', style=text_style)
    return total_h


def _draw_unified_construction_block(msp, box_x, top_y, box_w, hdr_h, row_h, title, rows,
                                     frame_thickness, text_h, text_style, footer_note=None):
    """Dibuja un Cuadro de Construcción Unificado de 6 columnas (EST-PV | RUMBO | DIST | VERT | NORTE | ESTE)."""
    colhdr_h = hdr_h * 0.85
    has_footer = bool(footer_note)
    total_h = hdr_h + colhdr_h + len(rows) * row_h + (row_h if has_footer else 0.0)

    _draw_rect(msp, box_x, top_y - total_h, box_w, total_h, thickness=frame_thickness * 0.5, layer='MARCO')
    _draw_line(msp, box_x, top_y - hdr_h, box_x + box_w, top_y - hdr_h, layer='MARCO')
    _draw_line(msp, box_x, top_y - hdr_h - colhdr_h, box_x + box_w, top_y - hdr_h - colhdr_h, layer='MARCO')

    _draw_cell_text_fit(
        msp, box_x + box_w * 0.5, top_y - hdr_h * 0.5,
        min(text_h * 0.85, hdr_h * 0.50), box_w, title, layer='TEXTOS', style=text_style
    )

    col_fracs = [0.12, 0.22, 0.11, 0.08, 0.235, 0.235]
    col_widths = [box_w * f for f in col_fracs]
    col_labels = ['EST-PV', 'RUMBO', 'DIST(m)', 'VERT', 'NORTE(m)', 'ESTE(m)']
    data_bottom_y = top_y - hdr_h - colhdr_h - len(rows) * row_h

    acc_x = box_x
    col_centers = []
    for c_idx, cw in enumerate(col_widths):
        col_centers.append(acc_x + cw * 0.5)
        if c_idx > 0:
            _draw_line(msp, acc_x, top_y - hdr_h, acc_x, data_bottom_y, layer='MARCO')
        acc_x += cw

    col_y = top_y - hdr_h - colhdr_h * 0.5
    col_lbl_h = min(text_h * 0.82, colhdr_h * 0.52)
    for c_idx, lbl in enumerate(col_labels):
        _draw_cell_text_fit(msp, col_centers[c_idx], col_y, col_lbl_h, col_widths[c_idx], lbl, layer='TEXTOS', style=text_style)

    val_h_base = min(text_h * 0.92, row_h * 0.68)
    val_h_coord = min(text_h * 1.02, row_h * 0.74)
    for r_idx, row in enumerate(rows):
        y_top = top_y - hdr_h - colhdr_h - r_idx * row_h
        y_mid = y_top - row_h * 0.5
        if r_idx > 0:
            _draw_line(msp, box_x, y_top, box_x + box_w, y_top, layer='MARCO')
        vals = [row['lado'], row['rumbo'], row['dist'], row['vert'], row['norte'], row['este']]
        for c_idx, val in enumerate(vals):
            cell_txt_h = val_h_coord if c_idx >= 3 else val_h_base
            _draw_cell_text_fit(msp, col_centers[c_idx], y_mid, cell_txt_h, col_widths[c_idx], val, layer='TEXTOS', style=text_style)

    if has_footer:
        _draw_line(msp, box_x, data_bottom_y, box_x + box_w, data_bottom_y, layer='MARCO')
        _draw_cell_text_fit(
            msp, box_x + box_w * 0.5, data_bottom_y - row_h * 0.5,
            min(text_h * 0.74, row_h * 0.60), box_w, footer_note, layer='TEXTOS', style=text_style
        )

    return total_h


def _draw_level1_classic_tables(msp, p_item, box_x, top_y, avail_h, box_w, table_unit,
                                frame_thickness, text_h, text_style, metadata,
                                get_bearing_fn, format_number_fn, clean_text_fn, extract_coords_fn):
    """Nivel 1 (N <= 15): Formato clásico de 4 tablas separadas, encuadrado exactamente dentro de avail_h."""
    p_pts = p_item['pts']
    p_geom_type = p_item['geometryType']
    p_area_m = p_item['area_mensura']
    p_area_doc = p_item['area_doc']

    pa_id, pa_x, pa_y = _resolve_punto_apoyo(p_item, p_pts, metadata, clean_text_fn, extract_coords_fn)
    n_pts = len(p_pts)
    n_segments = n_pts if p_geom_type == 'cerrada' else max(1, n_pts - 1)

    total_hdr_mult = 7.4  # balance(1.0) + pa(2.7) + rumbos(1.85) + coords(1.85)
    total_rows = 2 + 1 + n_segments + n_pts
    gap_h = min(table_unit * 0.9, avail_h * 0.012)
    total_gaps = 3.0 * gap_h
    usable_h = max(avail_h - total_gaps, 1e-4)

    hdr_h = min(table_unit * 3.2, usable_h / (total_hdr_mult + total_rows * 0.85))
    row_h = min(table_unit * 3.1, max(usable_h - total_hdr_mult * hdr_h, 1e-4) / max(total_rows, 1))

    t_y = top_y
    area_doc_txt = f"{format_number_fn(p_area_doc, 2)} m2"
    area_mens_txt = f"{format_number_fn(p_area_m, 2)} m2"

    # 1. Balance de Superficie
    bal_h = hdr_h + 2 * row_h
    _draw_rect(msp, box_x, t_y - bal_h, box_w, bal_h, thickness=frame_thickness * 0.5, layer='MARCO')
    _draw_line(msp, box_x, t_y - hdr_h, box_x + box_w, t_y - hdr_h, layer='MARCO')
    _draw_cell_text_fit(msp, box_x + box_w * 0.5, t_y - hdr_h * 0.5, min(text_h * 0.88, hdr_h * 0.50), box_w, 'BALANCE DE SUPERFICIE', layer='TEXTOS', style=text_style)

    bal_c1 = box_w * 0.58
    _draw_line(msp, box_x + bal_c1, t_y - hdr_h, box_x + bal_c1, t_y - bal_h, layer='MARCO')
    _draw_line(msp, box_x, t_y - hdr_h - row_h, box_x + box_w, t_y - hdr_h - row_h, layer='MARCO')

    bal_txt_h = min(text_h * 0.88, row_h * 0.65)
    bal_lbl_h = min(text_h * 0.60, row_h * 0.48)
    y1_mid = t_y - hdr_h - row_h * 0.5
    _draw_left_text(msp, box_x + text_h * 0.3, y1_mid, bal_lbl_h, 'AREA SEGUN DOCUMENTO', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + bal_c1 + (box_w - bal_c1) * 0.5, y1_mid, bal_txt_h, box_w - bal_c1, area_doc_txt, layer='TEXTOS', style=text_style)

    y2_mid = t_y - hdr_h - row_h * 1.5
    _draw_left_text(msp, box_x + text_h * 0.3, y2_mid, bal_lbl_h, 'AREA SEGUN MENSURA', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + bal_c1 + (box_w - bal_c1) * 0.5, y2_mid, bal_txt_h, box_w - bal_c1, area_mens_txt, layer='TEXTOS', style=text_style)
    t_y -= bal_h + gap_h

    # 2. Punto de Apoyo
    pa_subhdr_h = hdr_h * 0.85
    pa_colhdr_h = hdr_h * 0.85
    pa_h = hdr_h + pa_subhdr_h + pa_colhdr_h + row_h
    _draw_rect(msp, box_x, t_y - pa_h, box_w, pa_h, thickness=frame_thickness * 0.5, layer='MARCO')
    _draw_line(msp, box_x, t_y - hdr_h, box_x + box_w, t_y - hdr_h, layer='MARCO')
    _draw_line(msp, box_x, t_y - hdr_h - pa_subhdr_h, box_x + box_w, t_y - hdr_h - pa_subhdr_h, layer='MARCO')
    _draw_line(msp, box_x, t_y - hdr_h - pa_subhdr_h - pa_colhdr_h, box_x + box_w, t_y - hdr_h - pa_subhdr_h - pa_colhdr_h, layer='MARCO')

    _draw_cell_text_fit(msp, box_x + box_w * 0.5, t_y - hdr_h * 0.5, min(text_h * 0.86, hdr_h * 0.48), box_w, 'PUNTO DE APOYO (RED GEODESICA)', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + box_w * 0.5, t_y - hdr_h - pa_subhdr_h * 0.5, min(text_h * 0.78, pa_subhdr_h * 0.48), box_w, 'COORDENADAS REGVEN (UTM)', layer='TEXTOS', style=text_style)

    pa_c1 = box_w * 0.16
    pa_c2 = box_w * 0.42
    pa_c3 = box_w * 0.42
    _draw_line(msp, box_x + pa_c1, t_y - hdr_h - pa_subhdr_h, box_x + pa_c1, t_y - pa_h, layer='MARCO')
    _draw_line(msp, box_x + pa_c1 + pa_c2, t_y - hdr_h - pa_subhdr_h, box_x + pa_c1 + pa_c2, t_y - pa_h, layer='MARCO')

    pa_col_y = t_y - hdr_h - pa_subhdr_h - pa_colhdr_h * 0.5
    pa_chdr_h = min(text_h * 0.76, pa_colhdr_h * 0.48)
    _draw_cell_text_fit(msp, box_x + pa_c1 * 0.5, pa_col_y, pa_chdr_h, pa_c1, 'PUNTO', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + pa_c1 + pa_c2 * 0.5, pa_col_y, pa_chdr_h, pa_c2, 'NORTE', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + pa_c1 + pa_c2 + pa_c3 * 0.5, pa_col_y, pa_chdr_h, pa_c3, 'ESTE', layer='TEXTOS', style=text_style)

    pa_row_y = t_y - hdr_h - pa_subhdr_h - pa_colhdr_h - row_h * 0.5
    pa_val_h = min(text_h * 0.88, row_h * 0.65)
    _draw_cell_text_fit(msp, box_x + pa_c1 * 0.5, pa_row_y, pa_val_h, pa_c1, pa_id, layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + pa_c1 + pa_c2 * 0.5, pa_row_y, pa_val_h, pa_c2, format_number_fn(pa_y, 3), layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + pa_c1 + pa_c2 + pa_c3 * 0.5, pa_row_y, pa_val_h, pa_c3, format_number_fn(pa_x, 3), layer='TEXTOS', style=text_style)
    t_y -= pa_h + gap_h

    # 3. Cuadro de Rumbos y Distancias
    rb_hdr_h = hdr_h
    rb_colhdr_h = hdr_h * 0.85
    rb_h = rb_hdr_h + rb_colhdr_h + n_segments * row_h
    _draw_rect(msp, box_x, t_y - rb_h, box_w, rb_h, thickness=frame_thickness * 0.5, layer='MARCO')
    _draw_line(msp, box_x, t_y - rb_hdr_h, box_x + box_w, t_y - rb_hdr_h, layer='MARCO')
    _draw_line(msp, box_x, t_y - rb_hdr_h - rb_colhdr_h, box_x + box_w, t_y - rb_hdr_h - rb_colhdr_h, layer='MARCO')

    r_c_est = box_w * 0.12
    r_c_pv = box_w * 0.12
    r_c_lado = r_c_est + r_c_pv
    r_c_rumbo = box_w * 0.48
    r_c_dist = box_w - r_c_lado - r_c_rumbo
    _draw_line(msp, box_x + r_c_lado, t_y, box_x + r_c_lado, t_y - rb_h, layer='MARCO')
    _draw_line(msp, box_x + r_c_lado + r_c_rumbo, t_y, box_x + r_c_lado + r_c_rumbo, t_y - rb_h, layer='MARCO')
    _draw_line(msp, box_x + r_c_est, t_y - rb_hdr_h, box_x + r_c_est, t_y - rb_h, layer='MARCO')

    _draw_cell_text_fit(msp, box_x + r_c_lado * 0.5, t_y - rb_hdr_h * 0.5, min(text_h * 0.85, rb_hdr_h * 0.50), r_c_lado, 'LADO', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + r_c_lado + r_c_rumbo * 0.5, t_y - rb_hdr_h * 0.5, min(text_h * 0.85, rb_hdr_h * 0.50), r_c_rumbo, 'RUMBO', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + r_c_lado + r_c_rumbo + r_c_dist * 0.5, t_y - rb_hdr_h * 0.5, min(text_h * 0.78, rb_hdr_h * 0.48), r_c_dist, 'DISTANCIA', layer='TEXTOS', style=text_style)

    rb_sub_y = t_y - rb_hdr_h - rb_colhdr_h * 0.5
    rb_sh_h = min(text_h * 0.74, rb_colhdr_h * 0.48)
    _draw_cell_text_fit(msp, box_x + r_c_est * 0.5, rb_sub_y, rb_sh_h, r_c_est, 'EST', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + r_c_est + r_c_pv * 0.5, rb_sub_y, rb_sh_h, r_c_pv, 'PV', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + r_c_lado + r_c_rumbo * 0.5, rb_sub_y, rb_sh_h * 0.92, r_c_rumbo, '(GEODESICO)', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + r_c_lado + r_c_rumbo + r_c_dist * 0.5, rb_sub_y, rb_sh_h * 0.92, r_c_dist, '(m)', layer='TEXTOS', style=text_style)

    rb_txt_h = min(text_h * 0.94, row_h * 0.68)
    for s_idx in range(n_segments):
        p1 = p_pts[s_idx]
        p2 = p_pts[(s_idx + 1) % n_pts]
        dx = p2['x'] - p1['x']
        dy = p2['y'] - p1['y']
        edge_dist = math.hypot(dx, dy)
        bearing_str = get_bearing_fn(dx, dy)
        y_top = t_y - rb_hdr_h - rb_colhdr_h - s_idx * row_h
        y_mid = y_top - row_h * 0.5
        if s_idx > 0:
            _draw_line(msp, box_x, y_top, box_x + box_w, y_top, layer='MARCO')
        _draw_cell_text_fit(msp, box_x + r_c_est * 0.5, y_mid, rb_txt_h, r_c_est, normalize_vertex_id(p1.get('id'), s_idx + 1), layer='TEXTOS', style=text_style)
        _draw_cell_text_fit(msp, box_x + r_c_est + r_c_pv * 0.5, y_mid, rb_txt_h, r_c_pv, normalize_vertex_id(p2.get('id'), ((s_idx + 1) % n_pts) + 1), layer='TEXTOS', style=text_style)
        _draw_cell_text_fit(msp, box_x + r_c_lado + r_c_rumbo * 0.5, y_mid, rb_txt_h, r_c_rumbo, bearing_str, layer='TEXTOS', style=text_style)
        _draw_cell_text_fit(msp, box_x + r_c_lado + r_c_rumbo + r_c_dist * 0.5, y_mid, rb_txt_h, r_c_dist, format_number_fn(edge_dist, 2), layer='TEXTOS', style=text_style)
    t_y -= rb_h + gap_h

    # 4. Tabla de Coordenadas UTM
    coo_hdr_h = hdr_h
    coo_colhdr_h = hdr_h * 0.85
    coo_h = coo_hdr_h + coo_colhdr_h + n_pts * row_h
    _draw_rect(msp, box_x, t_y - coo_h, box_w, coo_h, thickness=frame_thickness * 0.5, layer='MARCO')
    _draw_line(msp, box_x, t_y - coo_hdr_h, box_x + box_w, t_y - coo_hdr_h, layer='MARCO')
    _draw_line(msp, box_x, t_y - coo_hdr_h - coo_colhdr_h, box_x + box_w, t_y - coo_hdr_h - coo_colhdr_h, layer='MARCO')
    _draw_cell_text_fit(msp, box_x + box_w * 0.5, t_y - coo_hdr_h * 0.5, min(text_h * 0.85, coo_hdr_h * 0.50), box_w, 'COORDENADAS (U.T.M)', layer='TEXTOS', style=text_style)

    c_c1 = box_w * 0.16
    c_c2 = box_w * 0.42
    c_c3 = box_w * 0.42
    _draw_line(msp, box_x + c_c1, t_y - coo_hdr_h, box_x + c_c1, t_y - coo_h, layer='MARCO')
    _draw_line(msp, box_x + c_c1 + c_c2, t_y - coo_hdr_h, box_x + c_c1 + c_c2, t_y - coo_h, layer='MARCO')

    coo_col_y = t_y - coo_hdr_h - coo_colhdr_h * 0.5
    coo_ch_h = min(text_h * 0.76, coo_colhdr_h * 0.48)
    _draw_cell_text_fit(msp, box_x + c_c1 * 0.5, coo_col_y, coo_ch_h, c_c1, 'PUNTO', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + c_c1 + c_c2 * 0.5, coo_col_y, coo_ch_h, c_c2, 'NORTE', layer='TEXTOS', style=text_style)
    _draw_cell_text_fit(msp, box_x + c_c1 + c_c2 + c_c3 * 0.5, coo_col_y, coo_ch_h, c_c3, 'ESTE', layer='TEXTOS', style=text_style)

    coord_txt_h = min(text_h * 1.02, row_h * 0.74)
    for idx, pt in enumerate(p_pts):
        y_top = t_y - coo_hdr_h - coo_colhdr_h - idx * row_h
        y_center = y_top - row_h * 0.5
        if idx > 0:
            _draw_line(msp, box_x, y_top, box_x + box_w, y_top, layer='MARCO')
        _draw_cell_text_fit(msp, box_x + c_c1 * 0.5, y_center, coord_txt_h, c_c1, normalize_vertex_id(pt.get('id'), idx + 1), layer='TEXTOS', style=text_style)
        _draw_cell_text_fit(msp, box_x + c_c1 + c_c2 * 0.5, y_center, coord_txt_h, c_c2, format_number_fn(pt['y'], 3), layer='TEXTOS', style=text_style)
        _draw_cell_text_fit(msp, box_x + c_c1 + c_c2 + c_c3 * 0.5, y_center, coord_txt_h, c_c3, format_number_fn(pt['x'], 3), layer='TEXTOS', style=text_style)


def render_adaptive_construction_tables(
    msp,
    processed_parcels,
    middle_box,
    inner,
    outer,
    margin,
    print_scale,
    text_h,
    frame_thickness,
    text_style,
    get_bearing_fn,
    format_number_fn,
    clean_text_fn,
    extract_coords_fn,
    metadata=None,
    project_name='PARCELA',
):
    """
    Motor Adaptativo de Cuadros de Construcción en 3 Niveles:
      - Nivel 1 (1 parcela, <= 15 pts): 4 tablas clásicas separadas encuadradas exactamente en middle_box.
      - Nivel 2 (16..38 pts o multiparcela que quepa legible en middle_box): Cuadro Unificado (1 fila/vértice).
      - Nivel 3 (> 38 pts o desborde): 35 filas en lámina principal + Módulo Anexo Lateral paginado (45 filas/col).
    Retorna extra_right_extent (0.0 si no hubo anexo).
    """
    if not processed_parcels:
        return 0.0

    table_unit = inner['h'] / 100.0
    t_y = inner['y'] + inner['h'] - table_unit * 1.5
    min_y_limit = inner['y'] + margin
    avail_h = max(t_y - min_y_limit, 1e-4)

    pad_x = margin * 0.35
    box_x = middle_box['x'] + pad_x
    box_w = middle_box['w'] - 2.0 * pad_x

    n_parcels = len(processed_parcels)
    total_vertices = sum(len(p['pts']) for p in processed_parcels)

    # ─ Nivel 1: 1 parcela y hasta 15 puntos ──────────────────────────────────
    if n_parcels == 1 and total_vertices <= 15:
        _draw_level1_classic_tables(
            msp, processed_parcels[0], box_x, t_y, avail_h, box_w, table_unit,
            frame_thickness, text_h, text_style, metadata,
            get_bearing_fn, format_number_fn, clean_text_fn, extract_coords_fn
        )
        return 0.0

    # ─ Evaluar si cabe completo en Nivel 2 (Cuadro Unificado) ────────────────
    gap_l2 = min(table_unit * 0.75, avail_h * 0.01)
    hdr_l2 = min(table_unit * 3.0, avail_h * 0.036)
    n_hdr_mult_l2 = n_parcels * (1.0 + 1.85)
    n_rows_l2 = n_parcels * 2 + total_vertices
    n_gaps_l2 = max(1, 2 * n_parcels - 1)
    avail_rows_l2 = avail_h - n_gaps_l2 * gap_l2 - n_hdr_mult_l2 * hdr_l2
    projected_row_h_l2 = avail_rows_l2 / max(n_rows_l2, 1)

    if total_vertices <= 38 and projected_row_h_l2 >= table_unit * 1.50:
        row_h = min(table_unit * 3.4, projected_row_h_l2)
        for p_item in processed_parcels:
            p_pts = p_item['pts']
            p_name = p_item['nombre']
            pa_id, pa_x, pa_y = _resolve_punto_apoyo(p_item, p_pts, metadata, clean_text_fn, extract_coords_fn)
            area_doc_txt = f"{format_number_fn(p_item['area_doc'], 2)} m2"
            area_mens_txt = f"{format_number_fn(p_item['area_mensura'], 2)} m2"
            bal_title = 'BALANCE Y PUNTO DE APOYO (REGVEN)' if n_parcels == 1 else f"{p_name}: BALANCE Y PTO. APOYO"
            used_bal = _draw_compact_balance_and_pa(
                msp, box_x, t_y, box_w, hdr_l2, row_h, bal_title,
                area_doc_txt, area_mens_txt, pa_id, pa_x, pa_y,
                frame_thickness, text_h, text_style, format_number_fn
            )
            t_y -= used_bal + gap_l2

            rows = _build_unified_rows_for_parcel(p_item, get_bearing_fn, format_number_fn)
            cuadro_title = 'CUADRO DE CONSTRUCCION CATASTRAL (UTM)' if n_parcels == 1 else f"CUADRO DE CONSTRUCCION: {p_name}"
            used_cuadro = _draw_unified_construction_block(
                msp, box_x, t_y, box_w, hdr_l2, row_h, cuadro_title, rows,
                frame_thickness, text_h, text_style
            )
            t_y -= used_cuadro + gap_l2
        return 0.0

    # ─ Nivel 3: Paginación (Primeros 35 en lámina + Anexo Lateral de 45/col) ─
    MAX_MAIN_ROWS = 35
    MAX_ANNEX_ROWS = 45

    all_rows = []
    for p_item in processed_parcels:
        p_rows = _build_unified_rows_for_parcel(p_item, get_bearing_fn, format_number_fn)
        if n_parcels > 1:
            p_tag = p_item['nombre'][:6]
            for r in p_rows:
                r['lado'] = f"{p_tag}:{r['lado']}"
        all_rows.extend(p_rows)

    main_rows = all_rows[:MAX_MAIN_ROWS]
    annex_rows = all_rows[MAX_MAIN_ROWS:]

    # Bloque superior en middle_box: Balance total + Punto de Apoyo
    first_parcel = processed_parcels[0]
    pa_id, pa_x, pa_y = _resolve_punto_apoyo(first_parcel, first_parcel['pts'], metadata, clean_text_fn, extract_coords_fn)
    total_area_doc = sum(p['area_doc'] for p in processed_parcels)
    total_area_mens = sum(p['area_mensura'] for p in processed_parcels)

    gap_l3 = table_unit * 0.8
    hdr_l3 = table_unit * 2.4
    n_main_slots = 2 + len(main_rows) + (1 if annex_rows else 0)
    avail_rows_l3 = avail_h - gap_l3 - (1.0 + 1.85) * hdr_l3
    row_h_l3 = min(table_unit * 2.8, max(avail_rows_l3 / max(n_main_slots, 1), table_unit * 1.45))

    used_bal = _draw_compact_balance_and_pa(
        msp, box_x, t_y, box_w, hdr_l3, row_h_l3,
        'BALANCE GENERAL Y PUNTO DE APOYO (REGVEN)',
        f"{format_number_fn(total_area_doc, 2)} m2",
        f"{format_number_fn(total_area_mens, 2)} m2",
        pa_id, pa_x, pa_y,
        frame_thickness, text_h, text_style, format_number_fn
    )
    t_y -= used_bal + gap_l3

    footer_note = None
    if annex_rows:
        footer_note = f"CONTINUA EN CUADRO ANEXO LATERAL -> ({len(annex_rows)} PTS)"
    _draw_unified_construction_block(
        msp, box_x, t_y, box_w, hdr_l3, row_h_l3,
        f"CUADRO DE CONSTRUCCION (1-{len(main_rows)} DE {len(all_rows)})",
        main_rows,
        frame_thickness, text_h, text_style,
        footer_note=footer_note
    )

    if not annex_rows:
        return 0.0

    # Módulo Anexo Oficial a la derecha del plano
    chunks = [annex_rows[i:i + MAX_ANNEX_ROWS] for i in range(0, len(annex_rows), MAX_ANNEX_ROWS)]
    n_cols = len(chunks)
    col_w = box_w
    col_gap = margin
    annex_outer_x = outer['x'] + outer['w'] + margin * 2.0
    annex_outer_y = outer['y']
    annex_outer_h = outer['h']
    annex_outer_w = n_cols * col_w + max(0, n_cols - 1) * col_gap + 4.0 * margin

    annex_inner_x = annex_outer_x + margin
    annex_inner_y = inner['y']
    annex_inner_w = annex_outer_w - 2.0 * margin
    annex_inner_h = inner['h']

    _draw_rect(msp, annex_outer_x, annex_outer_y, annex_outer_w, annex_outer_h, thickness=0.0, layer='MARCO')
    _draw_rect(msp, annex_inner_x, annex_inner_y, annex_inner_w, annex_inner_h, thickness=frame_thickness, layer='MARCO')

    title_band_h = table_unit * 4.0
    _draw_line(
        msp,
        annex_inner_x, annex_inner_y + annex_inner_h - title_band_h,
        annex_inner_x + annex_inner_w, annex_inner_y + annex_inner_h - title_band_h,
        layer='MARCO',
    )
    _draw_cell_text_fit(
        msp,
        annex_inner_x + annex_inner_w * 0.5,
        annex_inner_y + annex_inner_h - title_band_h * 0.5,
        min(text_h * 1.05, title_band_h * 0.48),
        annex_inner_w,
        f"ANEXO: CONTINUACION CUADRO DE CONSTRUCCION - {project_name}",
        layer='TEXTOS',
        style=text_style,
    )

    col_top_y = annex_inner_y + annex_inner_h - title_band_h - margin
    col_avail_h = col_top_y - (annex_inner_y + margin)
    hdr_annex = table_unit * 2.4
    row_h_annex = min(
        table_unit * 2.8,
        max((col_avail_h - 1.85 * hdr_annex) / MAX_ANNEX_ROWS, table_unit * 1.4),
    )

    start_idx = MAX_MAIN_ROWS + 1
    for c_idx, chunk in enumerate(chunks):
        cx_box = annex_inner_x + margin + c_idx * (col_w + col_gap)
        end_idx = start_idx + len(chunk) - 1
        _draw_unified_construction_block(
            msp, cx_box, col_top_y, col_w, hdr_annex, row_h_annex,
            f"CUADRO ANEXO ({start_idx}-{end_idx} DE {len(all_rows)})",
            chunk,
            frame_thickness, text_h, text_style
        )
        start_idx = end_idx + 1

    return (annex_outer_x + annex_outer_w + margin) - (outer['x'] + outer['w'])


# ══════════════════════════════════════════════════════════════════════════════
# UNIFICACIÓN TOPOLÓGICA DE PARCELAS (SOLO PUNTOS EXTERIORES)
# ══════════════════════════════════════════════════════════════════════════════

def _ring_remove_collinear(pts, dist_tol=0.01):
    """Elimina vértices repetidos y puntos colineales redundantes de un anillo cerrado."""
    cleaned = []
    for pt in pts:
        if not cleaned or math.hypot(pt['x'] - cleaned[-1]['x'], pt['y'] - cleaned[-1]['y']) > 1e-4:
            cleaned.append(dict(pt))
    while len(cleaned) > 1 and math.hypot(cleaned[0]['x'] - cleaned[-1]['x'], cleaned[0]['y'] - cleaned[-1]['y']) <= 1e-4:
        cleaned.pop()
    if len(cleaned) <= 3:
        return cleaned

    changed = True
    while changed and len(cleaned) > 3:
        changed = False
        next_pts = []
        n = len(cleaned)
        for i in range(n):
            prev = cleaned[(i - 1) % n]
            curr = cleaned[i]
            nxt = cleaned[(i + 1) % n]
            dx1, dy1 = curr['x'] - prev['x'], curr['y'] - prev['y']
            dx2, dy2 = nxt['x'] - curr['x'], nxt['y'] - curr['y']
            l1 = math.hypot(dx1, dy1)
            l2 = math.hypot(dx2, dy2)
            if l1 < 1e-6 or l2 < 1e-6:
                changed = True
                continue
            seg_dx, seg_dy = nxt['x'] - prev['x'], nxt['y'] - prev['y']
            seg_len = math.hypot(seg_dx, seg_dy)
            perp = abs(seg_dx * (curr['y'] - prev['y']) - seg_dy * (curr['x'] - prev['x'])) / max(seg_len, 1e-9)
            dot = dx1 * dx2 + dy1 * dy2
            if dot > 0 and perp <= dist_tol:
                changed = True
                continue
            next_pts.append(curr)
        cleaned = next_pts
    return cleaned


def unify_parcels_exterior(processed_parcels, snap_tol=0.05, project_name='PARCELA_UNIFICADA'):
    """
    Fusiona múltiples parcelas procesadas en un único polígono exterior cerrado,
    descartando todos los linderos internos compartidos y vértices interiores.
    """
    if not processed_parcels or len(processed_parcels) <= 1:
        return processed_parcels

    try:
        from shapely.geometry import Polygon
        from shapely.ops import unary_union
    except ImportError as exc:
        raise RuntimeError(f"Shapely requerido para unificación topológica de parcelas: {exc}")

    polys = []
    orig_vertices = []
    total_area_doc = 0.0

    for p_item in processed_parcels:
        total_area_doc += float(p_item.get('area_doc') or p_item.get('area_mensura') or 0.0)
        pts = p_item.get('pts') or []
        if len(pts) < 3:
            continue
        coords = [(float(pt['x']), float(pt['y'])) for pt in pts]
        orig_vertices.extend(coords)
        poly = Polygon(coords)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if not poly.is_empty and poly.area > 1e-6:
            polys.append(poly)

    if len(polys) <= 1:
        return processed_parcels

    # Cierre morfológico suave para soldar linderos colindantes con micro-separaciones <= snap_tol
    buffered = [poly.buffer(snap_tol, join_style=2) for poly in polys]
    merged = unary_union(buffered).buffer(-snap_tol, join_style=2)
    merged = merged.simplify(0.01, preserve_topology=True)

    if merged.geom_type == 'Polygon':
        ext_coords = list(merged.exterior.coords[:-1])
    elif merged.geom_type == 'MultiPolygon':
        # Parcelas disjuntas: envolvente exterior única sin puntos interiores
        hull = merged.convex_hull
        ext_coords = list(hull.exterior.coords[:-1])
    else:
        raise ValueError(f"Geometría resultante no poligonal al unificar: {merged.geom_type}")

    # Recuperar coordenadas exactas originales dentro de tolerancia para evitar deriva milimétrica
    snapped_pts = []
    snap_recover_tol = snap_tol * 1.5
    for vx, vy in ext_coords:
        best_pt = (vx, vy)
        best_dist = snap_recover_tol
        for ox, oy in orig_vertices:
            d = math.hypot(vx - ox, vy - oy)
            if d <= best_dist:
                best_dist = d
                best_pt = (ox, oy)
        snapped_pts.append({'x': best_pt[0], 'y': best_pt[1], 'id': ''})

    final_pts = _ring_remove_collinear(snapped_pts, dist_tol=0.01)
    if len(final_pts) < 3:
        raise ValueError("La unificación produjo menos de 3 vértices externos válidos.")

    for idx, pt in enumerate(final_pts):
        pt['id'] = f"P{idx + 1}"

    # Recalcular área, perímetro y orientación (Shoelace)
    n = len(final_pts)
    signed_a = 0.0
    perim_m = 0.0
    for i in range(n):
        p1 = final_pts[i]
        p2 = final_pts[(i + 1) % n]
        signed_a += p1['x'] * p2['y'] - p2['x'] * p1['y']
        perim_m += math.hypot(p2['x'] - p1['x'], p2['y'] - p1['y'])
    signed_a *= 0.5
    area_m = abs(signed_a)

    p_xs = [pt['x'] for pt in final_pts]
    p_ys = [pt['y'] for pt in final_pts]

    return [{
        'nombre': project_name or 'PARCELA_UNIFICADA',
        'geometryType': 'cerrada',
        'pts': final_pts,
        'area_mensura': area_m,
        'area_doc': total_area_doc if total_area_doc > 0 else area_m,
        'perim': perim_m,
        'is_ccw': signed_a > 0,
        'min_x': min(p_xs),
        'max_x': max(p_xs),
        'min_y': min(p_ys),
        'max_y': max(p_ys),
        'cx': (min(p_xs) + max(p_xs)) * 0.5,
        'cy': (min(p_ys) + max(p_ys)) * 0.5,
        'data_w': max(p_xs) - min(p_xs),
        'data_h': max(p_ys) - min(p_ys),
    }]

