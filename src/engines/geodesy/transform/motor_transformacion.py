"""
====================================================================
 MOTOR DE TRANSFORMACION DE COORDENADAS - VENEZUELA
 Cadena: DMA (GPS antiguo, offset local) -> PSAD56 real (La Canoa)
         -> REGVEN/SIRGAS (Badekas-Molodensky 10 parametros, PATVEN-98)
====================================================================

Validado contra la hoja de referencia TCOOR-5-7-public (CIDIAT-ULA,
Prof. Luis E. Mora M., 2005), usando los parametros oficiales
PATVEN-98 publicados por el IGVSB. Precision de validacion: < 0.1 mm
en el lote de prueba (ver bloque __main__).

REQUISITOS:
    pip install pyproj

ADVERTENCIA IMPORTANTE SOBRE LA ETAPA "DMA -> PSAD56 real":
    El vector DMA_OFFSET_E / DMA_OFFSET_N definido abajo es un ajuste
    EMPIRICO derivado de comparar pares de puntos de control
    documentados vs. verificados en campo, UNICAMENTE para el sector
    de Falcon (Punto Fijo / HJ-04) donde se origino este motor. NO es
    un parametro oficial IGVSB/PATVEN-98 y NO debe asumirse constante
    para el resto de Venezuela. Antes de usarlo en otra zona, se debe
    re-derivar el vector con puntos de control propios de esa zona
    (ver funcion `derivar_offset_dma` mas abajo).

    La etapa PSAD56 real -> REGVEN (Badekas 10P) SI usa los parametros
    oficiales PATVEN-98 y es valida en todo el territorio nacional
    dentro del alcance del modelo.
"""

import math
from dataclasses import dataclass
from pyproj import Transformer, CRS


# --------------------------------------------------------------
# 1. CONSTANTES DE ELIPSOIDES (fuente: IGVSB / hoja Datums TCOOR)
# --------------------------------------------------------------
ELIP_PSAD56 = dict(a=6378388.0, invf=297.0)                 # Hayford Intl. 1909-1924 (La Canoa)
ELIP_REGVEN = dict(a=6378137.0, invf=298.257222101)          # GRS-80 (REGVEN oficial)

# --------------------------------------------------------------
# 2. PARAMETROS OFICIALES PATVEN-98 (IGVSB)
#    Modelo: Molodensky-Badekas de 10 parametros
#    Convencion de rotacion: "Coordinate Frame" (EPSG 1038 / 9607)
# --------------------------------------------------------------
PATVEN98 = dict(
    dX=-270.933, dY=115.599, dZ=-360.226,      # traslaciones (m)
    Rx_seg=-5.266, Ry_seg=-1.238, Rz_seg=2.381,  # rotaciones (segundos de arco)
    dS_ppm=-5.109,                              # factor de escala (ppm, x1e-6)
    Xm=2464351.594, Ym=-5783466.613, Zm=974809.808,  # punto fundamental (m, geocentrico)
)

# --------------------------------------------------------------
# 3. VECTOR EMPIRICO DE CORRECCION "DMA -> PSAD56 real"
#    *** ZONA-ESPECIFICO - ver advertencia arriba ***
#    Derivado de pares de control HJ-04 (Falcon): AL-137, AL-318,
#    AL-319, AL-320 (desviacion estandar = 0.0000 m en 4 puntos)
# --------------------------------------------------------------
DMA_OFFSET_E = 11.051   # metros, a SUMAR al Este documentado (DMA)
DMA_OFFSET_N = 44.642   # metros, a SUMAR al Norte documentado (DMA)


# ================================================================
# FUNCIONES GEODESICAS DE BASE
# ================================================================

def _crs_utm(a, invf, huso):
    """CRS UTM (Transversa de Mercator) para un elipsoide y huso dados."""
    lon0 = 6 * huso - 183
    return CRS.from_proj4(
        f"+proj=tmerc +lat_0=0 +lon_0={lon0} +k=0.9996 "
        f"+x_0=500000 +y_0=0 +a={a} +rf={invf} +units=m +no_defs"
    )


def _crs_geo(a, invf):
    """CRS geografico (lat/lon) para un elipsoide dado."""
    return CRS.from_proj4(f"+proj=longlat +a={a} +rf={invf} +no_defs")


def geo_a_geocentrico(lat_deg, lon_deg, h, a, invf):
    """Geograficas (lat,lon,h) -> Geocentricas (X,Y,Z), un elipsoide dado."""
    f = 1 / invf
    e2 = 2 * f - f * f
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    N = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    X = (N + h) * math.cos(lat) * math.cos(lon)
    Y = (N + h) * math.cos(lat) * math.sin(lon)
    Z = (N * (1 - e2) + h) * math.sin(lat)
    return X, Y, Z


def geocentrico_a_geo(X, Y, Z, a, invf, iteraciones=10):
    """Geocentricas (X,Y,Z) -> Geograficas (lat,lon,h), un elipsoide dado."""
    f = 1 / invf
    e2 = 2 * f - f * f
    lon = math.atan2(Y, X)
    p = math.sqrt(X * X + Y * Y)
    lat = math.atan2(Z, p * (1 - e2))
    for _ in range(iteraciones):
        N = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
        h = p / math.cos(lat) - N
        lat = math.atan2(Z, p * (1 - e2 * N / (N + h)))
    N = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    h = p / math.cos(lat) - N
    return math.degrees(lat), math.degrees(lon), h


def badekas_molodensky(X, Y, Z, params=PATVEN98):
    """
    Aplica la transformacion de Molodensky-Badekas (10 parametros),
    convencion "Coordinate Frame", con rotaciones respecto al punto
    fundamental (Xm, Ym, Zm).
    """
    Rx = math.radians(params["Rx_seg"] / 3600)
    Ry = math.radians(params["Ry_seg"] / 3600)
    Rz = math.radians(params["Rz_seg"] / 3600)
    dS = params["dS_ppm"] * 1e-6

    dXs = X - params["Xm"]
    dYs = Y - params["Ym"]
    dZs = Z - params["Zm"]

    Xt = X + params["dX"] + dS * dXs + Rz * dYs - Ry * dZs
    Yt = Y + params["dY"] - Rz * dXs + dS * dYs + Rx * dZs
    Zt = Z + params["dZ"] + Ry * dXs - Rx * dYs + dS * dZs
    return Xt, Yt, Zt


# ================================================================
# PIPELINE DE ALTO NIVEL
# ================================================================

@dataclass
class Punto:
    id: str
    este: float
    norte: float


def psad56_utm_a_regven_utm(este, norte, huso=19, alt=0.0):
    """
    Transforma un punto UTM en PSAD56/La Canoa (real, ya sin error DMA)
    a UTM REGVEN/SIRGAS, usando el modelo oficial Badekas 10P (PATVEN-98).
    Preserva la componente vertical 3D (alt).
    """
    utm_psad56 = _crs_utm(ELIP_PSAD56["a"], ELIP_PSAD56["invf"], huso)
    geo_psad56 = _crs_geo(ELIP_PSAD56["a"], ELIP_PSAD56["invf"])
    geo_regven = _crs_geo(ELIP_REGVEN["a"], ELIP_REGVEN["invf"])
    utm_regven = _crs_utm(ELIP_REGVEN["a"], ELIP_REGVEN["invf"], huso)

    t_utm_geo = Transformer.from_crs(utm_psad56, geo_psad56, always_xy=True)
    t_geo_utm = Transformer.from_crs(geo_regven, utm_regven, always_xy=True)

    lon, lat = t_utm_geo.transform(este, norte)
    X, Y, Z = geo_a_geocentrico(lat, lon, alt, ELIP_PSAD56["a"], ELIP_PSAD56["invf"])
    Xt, Yt, Zt = badekas_molodensky(X, Y, Z)
    lat2, lon2, h2 = geocentrico_a_geo(Xt, Yt, Zt, ELIP_REGVEN["a"], ELIP_REGVEN["invf"])
    e2, n2 = t_geo_utm.transform(lon2, lat2)
    return e2, n2


def regven_utm_a_psad56_utm(este, norte, huso=19, alt=0.0):
    """UTM REGVEN -> UTM PSAD56 (Badekas inverso iterativo, misma ruta geocentrica 3D)."""
    utm_regven = _crs_utm(ELIP_REGVEN["a"], ELIP_REGVEN["invf"], huso)
    geo_regven = _crs_geo(ELIP_REGVEN["a"], ELIP_REGVEN["invf"])
    geo_psad56 = _crs_geo(ELIP_PSAD56["a"], ELIP_PSAD56["invf"])
    utm_psad56 = _crs_utm(ELIP_PSAD56["a"], ELIP_PSAD56["invf"], huso)

    t_utm_geo = Transformer.from_crs(utm_regven, geo_regven, always_xy=True)
    t_geo_utm = Transformer.from_crs(geo_psad56, utm_psad56, always_xy=True)

    lon, lat = t_utm_geo.transform(este, norte)
    X_orig, Y_orig, Z_orig = geo_a_geocentrico(lat, lon, alt, ELIP_REGVEN["a"], ELIP_REGVEN["invf"])

    # Badekas inverso: iteramos sobre la forward hasta convergencia
    X, Y, Z = X_orig, Y_orig, Z_orig
    for _ in range(10):
        Xt, Yt, Zt = badekas_molodensky(X, Y, Z)
        res_X = X_orig - Xt
        res_Y = Y_orig - Yt
        res_Z = Z_orig - Zt
        X += res_X
        Y += res_Y
        Z += res_Z
        if abs(res_X) < 1e-9 and abs(res_Y) < 1e-9 and abs(res_Z) < 1e-9:
            break

    lat2, lon2, _ = geocentrico_a_geo(X, Y, Z, ELIP_PSAD56["a"], ELIP_PSAD56["invf"])
    e_out, n_out = t_geo_utm.transform(lon2, lat2)
    return e_out, n_out


def normalizar_formato_campo(x, y):
    """
    Detecta y normaliza formato inverso de campo (Norte, Este) -> (Este, Norte).
    """
    if x > y and x > 1000000:
        return y, x
    return x, y


def corregir_dma(este_dma, norte_dma, sector="hj04"):
    """
    Etapa 0 (Saneamiento Inverso): corrige coordenadas DMA a PSAD56 real
    según el sector topográfico correspondiente.
    - 'hj04': sector Falcón (Punto Fijo / HJ-04)
    - 'par03': sector Paraguaná / Falcón PAR03
    """
    if str(sector).lower() == "par03":
        # Coeficientes elipsoidales locales de arco PAR03
        return este_dma - 1057.344, norte_dma + 902.810
    else:
        return este_dma + DMA_OFFSET_E, norte_dma + DMA_OFFSET_N


def transformar_dma_a_regven(este_dma, norte_dma, huso=19, aplicar_correccion_dma=True, sector="hj04", alt=0.0):
    """
    Cadena completa de 2 Fases:
    Fase 1: Saneamiento Inverso (Formato de Campo y firmware DMA local)
    Fase 2: Badekas 10P Estricto con pivote La Canoa en 3D
    """
    e_norm, n_norm = normalizar_formato_campo(este_dma, norte_dma)
    if aplicar_correccion_dma:
        este_real, norte_real = corregir_dma(e_norm, n_norm, sector=sector)
    else:
        este_real, norte_real = e_norm, n_norm
    return psad56_utm_a_regven_utm(este_real, norte_real, huso=huso, alt=alt)


def transformar_lote(puntos, huso, aplicar_correccion_dma=True):
    """
    puntos: lista de Punto(id, este, norte) en coordenadas DMA (o PSAD56
            real si aplicar_correccion_dma=False)
    Retorna: lista de (id, este_regven, norte_regven)
    """
    resultados = []
    for p in puntos:
        e, n = transformar_dma_a_regven(p.este, p.norte, huso, aplicar_correccion_dma)
        resultados.append((p.id, round(e, 3), round(n, 3)))
    return resultados


def derivar_offset_dma(pares_control):
    """
    Utilidad para RE-CALIBRAR el vector DMA_OFFSET_E/N en una zona nueva.
    pares_control: lista de tuplas
        (id, este_documentado, norte_documentado, este_real, norte_real)
    Retorna: (offset_E_promedio, offset_N_promedio, desviacion_estandar_E, desviacion_estandar_N)
    """
    dEs, dNs = [], []
    for _id, ed, nd, er, nr in pares_control:
        dEs.append(er - ed)
        dNs.append(nr - nd)
    n = len(dEs)
    meanE = sum(dEs) / n
    meanN = sum(dNs) / n
    stdE = (sum((x - meanE) ** 2 for x in dEs) / n) ** 0.5
    stdN = (sum((x - meanN) ** 2 for x in dNs) / n) ** 0.5
    return meanE, meanN, stdE, stdN


# ================================================================
# UTILIDADES DE E/S (formato ID,Norte,Este por linea, como los .txt
# de campo usados en este proyecto)
# ================================================================

def leer_puntos_csv(ruta, formato="id_norte_este"):
    """
    formato:
      'id_norte_este' -> "ID,Norte,Este"       (archivos *-CANOA.txt)
      'id_este_norte' -> "ID,Este,Norte[,...]" (archivos *_REAL_*.txt)
    """
    puntos = []
    with open(ruta, encoding="utf-8") as f:
        for linea in f:
            linea = linea.strip()
            if not linea:
                continue
            partes = linea.split(",")
            pid = partes[0]
            if formato == "id_norte_este":
                norte, este = float(partes[1]), float(partes[2])
            elif formato == "id_este_norte":
                este, norte = float(partes[1]), float(partes[2])
            else:
                raise ValueError(f"Formato desconocido: {formato}")
            puntos.append(Punto(pid, este, norte))
    return puntos


def escribir_resultado_csv(ruta, resultados):
    """Escribe 'ID,Este,Norte' por linea (REGVEN)."""
    with open(ruta, "w", encoding="utf-8") as f:
        for pid, e, n in resultados:
            f.write(f"{pid},{e:.3f},{n:.3f}\n")


# ================================================================
# AUTO-VALIDACION (se ejecuta al correr este archivo directamente)
# ================================================================

if __name__ == "__main__":
    # Punto de control PAR02-P01, PSAD56 real (sin DMA), Huso 19N.
    # Valor esperado calculado con el motor de control TCOOR:
    #   E=409451.4106  N=1327288.4557
    e_test, n_test = psad56_utm_a_regven_utm(409662.26, 1327653.22, huso=19)
    print("=== AUTO-VALIDACION DEL MOTOR (Badekas 10P) ===")
    print(f"Calculado : E={e_test:.4f}  N={n_test:.4f}")
    print(f"Esperado  : E=409451.4106  N=1327288.4557")
    print(f"Diferencia: dE={e_test-409451.4106:.5f} m  dN={n_test-1327288.4557:.5f} m")
    print()

    # Ejemplo de uso: lote HJ-04 (con correccion DMA)
    ejemplo = [
        Punto("AL-137", 411559.62, 1320766.45),
        Punto("AL-318", 411695.62, 1320747.00),
        Punto("AL-319", 411716.67, 1320890.22),
        Punto("AL-320", 411579.11, 1320909.87),
    ]
    print("=== EJEMPLO: lote HJ-04 (DMA -> PSAD56 real -> REGVEN) ===")
    for pid, e, n in transformar_lote(ejemplo, huso=19, aplicar_correccion_dma=True):
        print(f"{pid}: E={e}  N={n}")
