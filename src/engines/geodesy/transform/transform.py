import sys
import json
from pyproj import Transformer

def main():
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({'status': 'error', 'message': 'No input data provided'}))
            sys.exit(1)
        payload = json.loads(input_data)
        points = payload.get('points', [])
        direction = payload.get('direction', 'canoa_regven')
        method = payload.get('method', 'badekas')
        
        # Códigos EPSG por defecto según dirección de transformación (UTM Z19N)
        if direction == 'canoa_regven':
            default_source = 'EPSG:24879' # PSAD56 / UTM zone 19N
            default_target = 'EPSG:2202'  # REGVEN / UTM zone 19N
        elif direction == 'regven_canoa':
            default_source = 'EPSG:2202'  # REGVEN / UTM zone 19N
            default_target = 'EPSG:24879' # PSAD56 / UTM zone 19N
        else:
            default_source = 'EPSG:24879'
            default_target = 'EPSG:2202'

        source_crs = str(payload.get('source_crs') or default_source)
        target_crs = str(payload.get('target_crs') or default_target)

        dn = float(payload.get('dn', 0))
        de = float(payload.get('de', 0))

        # Verificar si corresponde a la transformación PSAD56 <-> REGVEN en UTM Z19N con PATVEN-98
        is_patven98_z19 = (
            (source_crs in ['EPSG:24879', '24879'] and target_crs in ['EPSG:2202', '2202']) or
            (source_crs in ['EPSG:2202', '2202'] and target_crs in ['EPSG:24879', '24879'])
        )

        if is_patven98_z19 and method in ['badekas', 'rigida']:
            if source_crs in ['EPSG:24879', '24879']:  # PSAD56 -> REGVEN (PATVEN-98 oficial)
                pipeline_str = (
                    "+proj=pipeline "
                    "+step +inv +proj=utm +zone=19 +ellps=intl "
                    "+step +proj=cart +ellps=intl "
                    "+step +proj=helmert +convention=coordinate_frame "
                    "+x=-270.933 +y=115.599 +z=-360.226 "
                    "+rx=-5.266 +ry=-1.238 +rz=2.381 +s=-5.109 "
                    "+exact "
                    "+step +inv +proj=cart +ellps=GRS80 "
                    "+step +proj=utm +zone=19 +ellps=GRS80"
                )
            else:  # REGVEN -> PSAD56 (Inversa PATVEN-98 oficial)
                pipeline_str = (
                    "+proj=pipeline "
                    "+step +inv +proj=utm +zone=19 +ellps=GRS80 "
                    "+step +proj=cart +ellps=GRS80 "
                    "+step +inv +proj=helmert +convention=coordinate_frame "
                    "+x=-270.933 +y=115.599 +z=-360.226 "
                    "+rx=-5.266 +ry=-1.238 +rz=2.381 +s=-5.109 "
                    "+exact "
                    "+step +inv +proj=cart +ellps=intl "
                    "+step +proj=utm +zone=19 +ellps=intl"
                )
            transformer = Transformer.from_pipeline(pipeline_str)
        else:
            transformer = Transformer.from_crs(source_crs, target_crs, always_xy=True)

        transformed_points = []
        for pt in points:
            x_in = float(pt.get('x') if 'x' in pt else pt.get('este', 0))
            y_in = float(pt.get('y') if 'y' in pt else pt.get('norte', 0))
            
            x_out, y_out = transformer.transform(x_in, y_in)
            
            if method == 'rigida':
                x_out += de
                y_out += dn
                
            transformed_points.append({
                'x': round(x_out, 3),
                'y': round(y_out, 3),
                'este': round(x_out, 3),
                'norte': round(y_out, 3)
            })

        print(json.dumps({
            'status': 'success',
            'transformed_points': transformed_points,
            'source_crs': source_crs,
            'target_crs': target_crs,
            'method': method,
            'direction': direction
        }))
    except Exception as e:
        print(json.dumps({'status': 'error', 'message': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()

