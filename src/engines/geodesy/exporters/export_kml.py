import sys
import json
import math
import os
import pathlib
import zipfile
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from pyproj import Transformer

def _extract_coords(pt):
    x, y = None, None
    for k_x in ('x', 'este', 'e'):
        if k_x in pt and pt[k_x] is not None:
            x = float(pt[k_x])
            break
    for k_y in ('y', 'norte', 'n'):
        if k_y in pt and pt[k_y] is not None:
            y = float(pt[k_y])
            break
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
        payload = data.get('payload', {})
        output_path = data.get('output_path')
        
        points_raw = payload.get('points') or payload.get('puntos', [])
        metadata = payload.get('metadata', {})
        project_name = metadata.get('projectName', 'PARCELA')
        
        if not points_raw or len(points_raw) < 3:
            print(json.dumps({'status': 'error', 'message': 'Insufficient points'}))
            sys.exit(1)

        provided_crs = payload.get('source_crs')
        geometry_type = payload.get('metadata', {}).get('geometryType', 'cerrada')
        x_first, y_first = _extract_coords(points_raw[0])
        if x_first is None or y_first is None:
            print(json.dumps({'status': 'error', 'message': 'Invalid coords'}), file=sys.stdout)
            sys.exit(1)

        is_already_wgs84 = (-180 <= x_first <= 180 and -90 <= y_first <= 90)
        if is_already_wgs84:
            wgs_points = []
            for pt in points_raw:
                cx, cy = _extract_coords(pt)
                if cx is None or cy is None: continue
                wgs_points.append((cy, cx) if cx > 0 and cy < 0 else (cx, cy))
            utm_points = wgs_points 
        else:
            candidates = [
                ('EPSG:32618', 'WGS84 Z18N'),
                ('proj=utm zone=18 datum=REGVEN', 'REGVEN Z18N'), 
                ('EPSG:32619', 'WGS84 Z19N'),
                ('proj=utm zone=19 datum=REGVEN', 'REGVEN Z19N'),
                ('EPSG:32620', 'WGS84 Z20N'),
                ('proj=utm zone=20 datum=REGVEN', 'REGVEN Z20N'),
            ]
            def is_in_venezuela(lon, lat):
                return -75.0 <= lon <= -58.0 and -1.0 <= lat <= 13.0
            final_crs = provided_crs
            if not final_crs:
                for crs, name in candidates:
                    try:
                        test_t = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True)
                        lon, lat = test_t.transform(x_first, y_first)
                        if is_in_venezuela(lon, lat):
                            final_crs = crs
                            break
                    except Exception: continue
                if not final_crs: final_crs = 'EPSG:32619'
            
            transformer = Transformer.from_crs(final_crs, 'EPSG:4326', always_xy=True)
            utm_points, wgs_points = [], []
            for pt in points_raw:
                cx, cy = _extract_coords(pt)
                if cx is None or cy is None: continue
                actual_e, actual_n = (cy, cx) if cx > 1000000 and cy < 1000000 else (cx, cy)
                utm_points.append((actual_e, actual_n))
                wgs_points.append(transformer.transform(actual_e, actual_n))

        if len(wgs_points) < 3:
            print(json.dumps({'status': 'error', 'message': 'Insufficient points'}), file=sys.stdout)
            sys.exit(1)

        ux, uy = [p[0] for p in utm_points], [p[1] for p in utm_points]
        data_w, data_h = max(ux) - min(ux), max(uy) - min(uy)
        aspect = data_w / data_h if data_h != 0 else 1.0
        fig_size = 10.0
        fig = plt.figure(figsize=(fig_size * aspect, fig_size) if aspect > 1.0 else (fig_size, fig_size / aspect))
        ax = fig.add_axes([0, 0, 1, 1])
        ax.set_aspect('equal')
        ax.plot(ux + [ux[0]], uy + [uy[0]], color='blue', linewidth=2)
        ax.fill(ux + [ux[0]], uy + [uy[0]], color='skyblue', alpha=0.3)
        ax.scatter(ux, uy, color='red', s=20)
        ax.set_axis_off()
        ax.set_xlim(min(ux), max(ux))
        ax.set_ylim(min(uy), max(uy))
        
        temp_dir = Path(output_path).parent / f"temp_{Path(output_path).stem}"
        temp_dir.mkdir(parents=True, exist_ok=True)
        img_path = temp_dir / "parcel.png"
        fig.savefig(img_path, transparent=True, dpi=300, pad_inches=0)
        plt.close(fig)
        plt.close('all')
        import gc
        gc.collect()

        lons, lats = [p[0] for p in wgs_points], [p[1] for p in wgs_points]
        min_lon, max_lon, min_lat, max_lat = min(lons), max(lons), min(lats), max(lats)
        
        if geometry_type == 'puntos':
            coords_str = "" # Handled by Placemarks
        elif geometry_type == 'abierta':
            coords_str = " ".join([f"{p[0]},{p[1]},0" for p in wgs_points])
        else: # cerrada
            coords_str = " ".join([f"{p[0]},{p[1]},0" for p in wgs_points]) + f" {wgs_points[0][0]},{wgs_points[0][1]},0"
        
        # Generate Placemarks for each point
        points_placemarks = ""
        for i, p in enumerate(wgs_points):
            points_placemarks += f"""      <Placemark>
        <name>V{i+1}</name>
        <Point><coordinates>{p[0]},{p[1]},0</coordinates></Point>
      </Placemark>
"""
        
        kml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>{project_name}</name>
    <Folder>
      <name>{project_name} - Parcel Data</name>
        {points_placemarks}
      <Placemark>
        <name>{project_name} - Boundary</name>
        <Style><LineStyle><color>ff00ffff</color><width>3</width></LineStyle><PolyStyle><color>4000ffff</color></PolyStyle></Style>
        {f'<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>{coords_str}</coordinates></LinearRing></outerBoundaryIs></Polygon>' if geometry_type == 'cerrada' else ''}
        {f'<LineString><tessellate>1</tessellate><coordinates>{coords_str}</coordinates></LineString>' if geometry_type == 'abierta' else ''}
      </Placemark>
      <Placemark>
        <name>{project_name} - Image Overlay</name>
        <GroundOverlay><Icon><href>parcel.png</href></Icon><LatLonBox><north>{max_lat}</north><south>{min_lat}</south><east>{max_lon}</east><west>{min_lon}</west></LatLonBox></GroundOverlay>
      </Placemark>
    </Folder>
  </Document>
</kml>"""
        kml_path = temp_dir / "doc.kml"
        with open(kml_path, "w", encoding="utf-8") as f: f.write(kml_content)

        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as kmz:
            kmz.write(kml_path, arcname="doc.kml")
            kmz.write(img_path, arcname="parcel.png")
        
        import shutil
        shutil.rmtree(temp_dir)
        print(json.dumps({'status': 'success', 'file': output_path}))

    except Exception as e:
        import traceback
        print(json.dumps({'status': 'error', 'message': str(e), 'traceback': traceback.format_exc()}))
        sys.exit(1)

if __name__ == '__main__':
    main()
