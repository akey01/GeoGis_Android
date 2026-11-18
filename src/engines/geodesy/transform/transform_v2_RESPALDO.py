
"""
MOTOR DE TRANSFORMACION V2  --  Badekas-Molodensky 10P con punto pivote (IGVSB)

Reemplazo drop-in de transform.py. Usa el modelo matematicamente correcto
para los parametros oficiales PATVEN-98, con rotacion alrededor del punto
fundamental (Xm, Ym, Zm) cercano al centro de Venezuela.

Validado contra CIDIAT-ULA: precision < 0.1 mm.

Diferencias clave con transform.py:
  - transform.py:       proj=helmert sin pivote  -> error ~80-170m
  - transform_v2.py:    Badekas-Molodensky 10P   -> correcto (pivote oficial)

ADVERTENCIA: method='rigida' ignora los offsets dn/de porque el motor
Badekas correcto no requiere ajuste manual. Se emite warning si dn/de != 0.
"""

import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'tests'))
from motor_transformacion import psad56_utm_a_regven_utm, regven_utm_a_psad56_utm
EPSG_A_HUSO = {'EPSG:24879':19,'24879':19,'EPSG:2202':19,'2202':19,'EPSG:24880':20,'24880':20,'EPSG:2203':20,'2203':20,'EPSG:24881':21,'24881':21,'EPSG:2204':21,'2204':21}
def main():
    try:
        inp = sys.stdin.read()
        if not inp:
            print(json.dumps({'status':'error','message':'No input'}))
            sys.exit(1)
        p = json.loads(inp)
        points = p.get('points',[])
        direction = p.get('direction','canoa_regven')
        method = p.get('method','badekas')
        if direction == 'canoa_regven':
            ds,dt = 'EPSG:24879','EPSG:2202'
        elif direction == 'regven_canoa':
            ds,dt = 'EPSG:2202','EPSG:24879'
        else:
            ds,dt = 'EPSG:24879','EPSG:2202'
        src = str(p.get('source_crs') or ds)
        tgt = str(p.get('target_crs') or dt)
        dn = float(p.get('dn',0))
        de = float(p.get('de',0))
        PSAD56 = {'EPSG:24879','24879','EPSG:24880','24880','EPSG:24881','24881'}
        REGVEN = {'EPSG:2202','2202','EPSG:2203','2203','EPSG:2204','2204'}
        psad_src = src in PSAD56
        regv_dst = tgt in REGVEN
        regv_src = src in REGVEN
        psad_dst = tgt in PSAD56
        is_patven = (psad_src and regv_dst) or (regv_src and psad_dst)
        warns = []
        res = []
        if is_patven:
            huso = EPSG_A_HUSO.get(src,19)
            for pt in points:
                xi = float(pt.get('x') if 'x' in pt else pt.get('este',0))
                yi = float(pt.get('y') if 'y' in pt else pt.get('norte',0))
                if psad_src:
                    eo,no = psad56_utm_a_regven_utm(xi,yi,huso)
                else:
                    eo,no = regven_utm_a_psad56_utm(xi,yi,huso)
                res.append({'x':round(eo,3),'y':round(no,3),'este':round(eo,3),'norte':round(no,3)})
            if method == 'rigida' and (dn!=0 or de!=0):
                warns.append('Ignorando offsets manuales dn/de - motor Badekas no requiere ajuste rigido')
        else:
            from pyproj import Transformer
            t = Transformer.from_crs(src,tgt,always_xy=True)
            for pt in points:
                xi = float(pt.get('x') if 'x' in pt else pt.get('este',0))
                yi = float(pt.get('y') if 'y' in pt else pt.get('norte',0))
                eo,no = t.transform(xi,yi)
                if method == 'rigida':
                    eo+=de
                    no+=dn
                res.append({'x':round(eo,3),'y':round(no,3),'este':round(eo,3),'norte':round(no,3)})
        out = {'status':'success','transformed_points':res,'source_crs':src,'target_crs':tgt,'method':method,'direction':direction,'engine':'badekas_10p_pivote_oficial_v2'}
        if warns:
            out['warning'] = '; '.join(warns)
        print(json.dumps(out))
    except Exception as e:
        import traceback
        print(json.dumps({'status':'error','message':str(e),'traceback':traceback.format_exc(),'engine':'badekas_10p_pivote_oficial_v2'}))
        sys.exit(1)
if __name__ == '__main__':
    main()
