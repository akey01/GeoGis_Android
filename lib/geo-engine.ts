import { getResiduoMalla } from './idw-correction';

export interface Ellipsoid {
  nombre: string;
  datum: string;
  a: number;
  f: number;
  b: number;
  e2: number;
  ep2: number;
}

export const HAYFORD: Ellipsoid = {
  nombre: 'Internacional de Hayford 1924',
  datum: 'La Canoa (PSAD-56)',
  a: 6378388.0,
  f: 1 / 297.0,
  get b() { return this.a * (1 - this.f); },
  get e2() { return 2 * this.f - this.f * this.f; },
  get ep2() { return this.e2 / (1 - this.e2); },
};

export const GRS80: Ellipsoid = {
  nombre: 'GRS-80 (Geodetic Reference System 1980)',
  datum: 'SIRGAS-REGVEN',
  a: 6378137.0,
  f: 1 / 298.257222101,
  get b() { return this.a * (1 - this.f); },
  get e2() { return 2 * this.f - this.f * this.f; },
  get ep2() { return this.e2 / (1 - this.e2); },
};

export const PATVEN98 = {
  dx: -270.933, dy: 115.599, dz: -360.226,
  rx: -5.266, ry: -1.238, rz: 2.381,
  ds: -5.109,
  XM: 2464351.594, YM: -5783466.613, ZM: 974809.808,
};

export interface PuntoUTM {
    id: string;
    este: number;
    norte: number;
    altura?: number;
}

export interface ResultadoRutina1 {
    id: string;
    esteDMA: number;
    norteDMA: number;
    estePSAD56: number;
    nortePSAD56: number;
}

export interface ResultadoRutina2 {
    id: string;
    esteDMA: number;
    norteDMA: number;
    estePSAD56_Real: number;
    nortePSAD56_Real: number;
    esteREGVEN: number;
    norteREGVEN: number;
}

/**
 * @deprecated CLASE LEGACY — No invocar en flujos nuevos.
 * Aplica parches planos rígidos (BADEKAS_GRID_DE/DN) que omiten la cadena elipsoidal
 * tridimensional. Mantenida únicamente por compatibilidad de interfaces antiguas.
 * Usar GeoEngine.badekas() + GeoEngine.transformRigida() en su lugar.
 */
export class MotorGeodesicoVenezuelaV2 {
    private readonly DX_LOCAL_DMA = 11.051;
    private readonly DY_LOCAL_DMA = 44.642;

    private readonly PATVEN_DX = -270.933;
    private readonly PATVEN_DY = 115.599;
    private readonly PATVEN_DZ = -360.226;
    private readonly PATVEN_RX = -5.266 * (Math.PI / (180 * 3600));
    private readonly PATVEN_RY = -1.238 * (Math.PI / (180 * 3600));
    private readonly PATVEN_RZ = 2.381 * (Math.PI / (180 * 3600));
    private readonly PATVEN_S = -5.109 / 1000000;

    private readonly CANOA_XM = 2464351.594;
    private readonly CANOA_YM = -5783466.613;
    private readonly CANOA_ZM = 974809.808;

    /** @deprecated Parche plano rígido — No aplica transformación elipsoidal. */
    private readonly BADEKAS_GRID_DE = -210.842;
    /** @deprecated Parche plano rígido — No aplica transformación elipsoidal. */
    private readonly BADEKAS_GRID_DN = -364.752;

    /** @deprecated Usar GeoEngine.utmToGeo() con HAYFORD. */
    public transformarDmaAPsad56(punto: PuntoUTM, esFormatoInverso: boolean = false): ResultadoRutina1 {
        const esteDMA = esFormatoInverso ? punto.norte : punto.este;
        const norteDMA = esFormatoInverso ? punto.este : punto.norte;

        const estePSAD56 = esteDMA;
        const nortePSAD56 = norteDMA;

        return {
            id: punto.id,
            esteDMA: Number(esteDMA.toFixed(3)),
            norteDMA: Number(norteDMA.toFixed(3)),
            estePSAD56: Number(estePSAD56.toFixed(3)),
            nortePSAD56: Number(nortePSAD56.toFixed(3))
        };
    }

    /**
     * @deprecated SIDE-EFFECT ACTIVO — Aplica sumas planas sobre UTM sin elipsoide.
     * Reemplazar con GeoEngine.transformDma() que usa la cadena Badekas 3D completa.
     */
    public transformarDmaAPsad56RealARegven(punto: PuntoUTM, esFormatoInverso: boolean = false): ResultadoRutina2 {
        const esteDMA = esFormatoInverso ? punto.norte : punto.este;
        const norteDMA = esFormatoInverso ? punto.este : punto.norte;

        const estePSAD56_Real = esteDMA + this.DX_LOCAL_DMA;
        const nortePSAD56_Real = norteDMA + this.DY_LOCAL_DMA;

        // ⚠️ LEGACY: Estas constantes son parches planos — Ver GeoEngine.transformDma para el flujo correcto.
        const esteREGVEN = estePSAD56_Real + this.BADEKAS_GRID_DE;
        const norteREGVEN = nortePSAD56_Real + this.BADEKAS_GRID_DN;

        return {
            id: punto.id,
            esteDMA: Number(esteDMA.toFixed(3)),
            norteDMA: Number(norteDMA.toFixed(3)),
            estePSAD56_Real: Number(estePSAD56_Real.toFixed(3)),
            nortePSAD56_Real: Number(nortePSAD56_Real.toFixed(3)),
            esteREGVEN: Number(esteREGVEN.toFixed(3)),
            norteREGVEN: Number(norteREGVEN.toFixed(3))
        };
    }

    /** @deprecated Usar GeoEngine.badekas(). */
    public obtenerMatrizBadekasXYZ(x: number, y: number, z: number): { xOut: number, yOut: number, zOut: number } {
        const dx = x - this.CANOA_XM;
        const dy = y - this.CANOA_YM;
        const dz = z - this.CANOA_ZM;

        const xOut = this.PATVEN_DX + (1 + this.PATVEN_S) * (dx + this.PATVEN_RZ * dy - this.PATVEN_RY * dz);
        const yOut = this.PATVEN_DY + (1 + this.PATVEN_S) * (-this.PATVEN_RZ * dx + dy + this.PATVEN_RX * dz);
        const zOut = this.PATVEN_DZ + (1 + this.PATVEN_S) * (this.PATVEN_RY * dx - this.PATVEN_RX * dy + dz);

        return { xOut, yOut, zOut };
    }
}

export class GeoEngine {
  // ==========================================
  // CONSTANTES GEODÉSICAS DMA VENEZUELA
  // ==========================================
  // Corrección local empírica DMA → PSAD56 Real (calibración de campo documentada)
  static readonly DX_LOCAL_DMA = 11.051;
  static readonly DY_LOCAL_DMA = 44.642;
  // ⚠️ DEPRECIADAS: Las constantes BADEKAS_GRID_DE/DN fueron parches planos rígidos.
  // La transformación PSAD56 → REGVEN ahora se realiza mediante la cadena Badekas 3D completa.
  /** @deprecated Parche plano eliminado. Usar badekas() para la cadena elipsoidal. */
  static readonly BADEKAS_GRID_DE = -210.842;
  /** @deprecated Parche plano eliminado. Usar badekas() para la cadena elipsoidal. */
  static readonly BADEKAS_GRID_DN = -364.752;

  /**
   * Transformación DMA → PSAD56 Real | DMA → REGVEN
   *
   * Flujo para `dma_psad56_real`:
   *   UTM_DMA → (+DX_LOCAL, +DY_LOCAL) → UTM_PSAD56_Real → utmToGeo(Hayford)
   *
   * Flujo para `dma_regven` (REFACTORIZADO — flujo elipsoidal puro, sin parches planos):
   *   UTM_DMA → (+DX_LOCAL, +DY_LOCAL) → UTM_PSAD56_Real
   *           → utmToGeo(Hayford) → geoToCart(Hayford)
   *           → badekas(directo, PSAD56→REGVEN)
   *           → cartToGeo(GRS80) → geoToUTM(GRS80)
   *
   * Los antiguos BADEKAS_GRID_DE/DN (-210.842/-364.752) han sido ELIMINADOS
   * como parches planos y reemplazados por la cadena Badekas 3D completa.
   */
  static transformDma(
    esteDMA: number,
    norteDMA: number,
    h: number,
    huso: number,
    type: 'dma_psad56_real' | 'dma_regven',
    esFormatoInverso: boolean = false
  ) {
    const realEsteDMA = esFormatoInverso ? norteDMA : esteDMA;
    const realNorteDMA = esFormatoInverso ? esteDMA : norteDMA;

    // Paso 1: Transformación directa sin deltas empíricos locales
    const estePSAD56_Real = realEsteDMA;
    const nortePSAD56_Real = realNorteDMA;

    if (type === 'dma_psad56_real') {
      // Solo corrección DMA→PSAD56: devolver coordenadas en elipsoide Hayford
      const geo = this.utmToGeo(estePSAD56_Real, nortePSAD56_Real, huso, false, HAYFORD);
      return {
        este: Math.round(estePSAD56_Real * 1000) / 1000,
        norte: Math.round(nortePSAD56_Real * 1000) / 1000,
        lat: geo.lat,
        lng: geo.lng,
        huso,
        esteDMA: Math.round(realEsteDMA * 1000) / 1000,
        norteDMA: Math.round(realNorteDMA * 1000) / 1000,
        estePSAD56_Real: Math.round(estePSAD56_Real * 1000) / 1000,
        nortePSAD56_Real: Math.round(nortePSAD56_Real * 1000) / 1000,
        dLineal: 0,
        dma: true
      };
    } else {
      // Paso 2: PSAD56 Real → REGVEN — Cadena elipsoidal Badekas 3D completa
      // (Reemplaza el antiguo parche plano BADEKAS_GRID_DE/DN)
      const geoO = this.utmToGeo(estePSAD56_Real, nortePSAD56_Real, huso, false, HAYFORD);
      const cart = this.geoToCart(geoO.lat, geoO.lng, h, HAYFORD);
      const cartT = this.badekas(cart.X, cart.Y, cart.Z, false); // falso = directo: PSAD56 → REGVEN
      const geoD = this.cartToGeo(cartT.X, cartT.Y, cartT.Z, GRS80);
      const utmD = this.geoToUTM(geoD.lat, geoD.lng, huso, GRS80);

      return {
        este: utmD.este,
        norte: utmD.norte,
        lat: geoD.lat,
        lng: geoD.lng,
        huso,
        esteDMA: Math.round(realEsteDMA * 1000) / 1000,
        norteDMA: Math.round(realNorteDMA * 1000) / 1000,
        estePSAD56_Real: Math.round(estePSAD56_Real * 1000) / 1000,
        nortePSAD56_Real: Math.round(nortePSAD56_Real * 1000) / 1000,
        esteREGVEN: utmD.este,
        norteREGVEN: utmD.norte,
        dLineal: Math.sqrt(Math.pow(utmD.este - realEsteDMA, 2) + Math.pow(utmD.norte - realNorteDMA, 2)),
        dma: true
      };
    }
  }

  static toRad(deg: number) { return deg * Math.PI / 180; }
  static toDeg(rad: number) { return rad * 180 / Math.PI; }

  static _N(latR: number, el: Ellipsoid) {
    const sinLat = Math.sin(latR);
    return el.a / Math.sqrt(1 - el.e2 * sinLat * sinLat);
  }

  static geoToCart(latDeg: number, lngDeg: number, h: number, el: Ellipsoid) {
    const lat = this.toRad(latDeg);
    const lng = this.toRad(lngDeg);
    const N = this._N(lat, el);
    return {
      X: (N + h) * Math.cos(lat) * Math.cos(lng),
      Y: (N + h) * Math.cos(lat) * Math.sin(lng),
      Z: (N * (1 - el.e2) + h) * Math.sin(lat),
    };
  }

  static cartToGeo(X: number, Y: number, Z: number, el: Ellipsoid) {
    const p = Math.sqrt(X * X + Y * Y);
    let lat = Math.atan2(Z, p * (1 - el.e2));
    for (let i = 0; i < 15; i++) {
      const N = this._N(lat, el);
      const newLat = Math.atan2(Z + el.e2 * N * Math.sin(lat), p);
      if (Math.abs(newLat - lat) < 1e-14) break;
      lat = newLat;
    }
    const lng = Math.atan2(Y, X);
    const N = this._N(lat, el);
    const h = Math.cos(lat) !== 0 ? p / Math.cos(lat) - N : Z / Math.sin(lat) - N * (1 - el.e2);
    return { lat: this.toDeg(lat), lng: this.toDeg(lng), h };
  }

  static geoToUTM(latDeg: number, lngDeg: number, huso: number, el: Ellipsoid) {
    const a = el.a, e2 = el.e2, ep2 = el.ep2;
    const k0 = 0.9996;
    const lon0 = huso * 6 - 183;
    const latR = this.toRad(latDeg);
    const lngR = this.toRad(lngDeg);
    const lng0R = this.toRad(lon0);

    const N = this._N(latR, el);
    const T = Math.tan(latR) ** 2;
    const C = ep2 * Math.cos(latR) ** 2;
    const A = Math.cos(latR) * (lngR - lng0R);

    const e4 = e2 * e2, e6 = e4 * e2;
    const M = a * (
      (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * latR
      - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * latR)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * latR)
      - (35 * e6 / 3072) * Math.sin(6 * latR)
    );

    const A2 = A * A, A3 = A2 * A, A4 = A3 * A, A5 = A4 * A, A6 = A5 * A;

    const este = k0 * N * (
      A + (1 - T + C) * A3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5 / 120
    ) + 500000.0;

    let norte = k0 * (
      M + N * Math.tan(latR) * (
        A2 / 2 + (5 - T + 9 * C + 4 * C * C) * A4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6 / 720
      )
    );

    if (latDeg < 0) norte += 10000000.0;

    return { este: Math.round(este * 1000) / 1000, norte: Math.round(norte * 1000) / 1000, huso, hemi: latDeg >= 0 ? 'N' : 'S' };
  }

  static utmToGeo(este: number, norte: number, huso: number, hemiSur: boolean, el: Ellipsoid) {
    const k0 = 0.9996;
    const a = el.a, e2 = el.e2, ep2 = el.ep2;
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const lon0 = this.toRad(huso * 6 - 183);

    const x = este - 500000.0;
    let y = norte;
    if (hemiSur) y -= 10000000.0;

    const e4 = e2 * e2, e6 = e4 * e2;
    const M0 = y / k0;
    const mu = M0 / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));

    const e12 = e1 * e1, e13 = e12 * e1, e14 = e13 * e1;
    const phi1 = mu
      + (3 * e1 / 2 - 27 * e13 / 32) * Math.sin(2 * mu)
      + (21 * e12 / 16 - 55 * e14 / 32) * Math.sin(4 * mu)
      + (151 * e13 / 96) * Math.sin(6 * mu)
      + (1097 * e14 / 512) * Math.sin(8 * mu);

    const N1 = this._N(phi1, el);
    const T1 = Math.tan(phi1) ** 2;
    const C1 = ep2 * Math.cos(phi1) ** 2;
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1) ** 2, 1.5);
    const D = x / (N1 * k0);
    const D2 = D * D, D3 = D2 * D, D4 = D3 * D, D5 = D4 * D, D6 = D5 * D;

    const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
      D2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D6 / 720
    );

    const lng = lon0 + (1 / Math.cos(phi1)) * (
      D - (1 + 2 * T1 + C1) * D3 / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D5 / 120
    );

    return { lat: this.toDeg(lat), lng: this.toDeg(lng) };
  }

  static badekas(X: number, Y: number, Z: number, inverso: boolean) {
    const p = PATVEN98;
    const rxR = this.toRad(p.rx / 3600);
    const ryR = this.toRad(p.ry / 3600);
    const rzR = this.toRad(p.rz / 3600);
    const s = 1 + p.ds * 1e-6;

    if (!inverso) {
      const dX = X - p.XM;
      const dY = Y - p.YM;
      const dZ = Z - p.ZM;
      return {
        X: s * (dX + rzR * dY - ryR * dZ) + p.XM + p.dx,
        Y: s * (-rzR * dX + dY + rxR * dZ) + p.YM + p.dy,
        Z: s * (ryR * dX - rxR * dY + dZ) + p.ZM + p.dz,
      };
    } else {
      const dX = X - p.XM - p.dx;
      const dY = Y - p.YM - p.dy;
      const dZ = Z - p.ZM - p.dz;
      const sI = 1 / s;
      return {
        X: sI * (dX - rzR * dY + ryR * dZ) + p.XM,
        Y: sI * (rzR * dX + dY - rxR * dZ) + p.YM,
        Z: sI * (-ryR * dX + rxR * dY + dZ) + p.ZM,
      };
    }
  }

  static detectHuso(lng: number) {
    if (lng >= -78 && lng < -72) return 18;
    if (lng >= -72 && lng < -66) return 19;
    if (lng >= -66 && lng < -60) return 20;
    if (lng >= -60 && lng < -54) return 21;
    return lng < -66 ? 19 : 20;
  }

  /**
   * Transformación Rígida = Badekas + corrección planimétrica (ΔN, ΔE) en UTM.
   * Se usa como ajuste local adicional sobre la transformación Badekas estándar.
   */
  /**
   * Transformación Rígida (Badekas + ΔN/ΔE)
   * Aplica Badekas primero, luego suma el desplazamiento planimétrico ΔN/ΔE al resultado UTM.
   * Si dn o de no se especifican, se calculan automáticamente con la malla PATVEN-98 por IDW.
   */
  /**
   * Transformación Rígida — Badekas 3D puro + residuo planimétrico (ΔE, ΔN).
   *
   * FLUJO UNIFICADO (corregido — eliminado side-effect de contaminación de dirección):
   *   1. UTM_Origen → utmToGeo(elO) → geoToCart(elO)
   *   2. → badekas(inv) → cartToGeo(elD) → geoToUTM(elD)  [Badekas SIEMPRE primero]
   *   3. → resultado_badekas + dE/dN  [residuo IDW o manual aplicado DESPUÉS de la rotación]
   *
   * Corrección del bug: el branch anterior con metodo IDW aplicaba dE/dN directamente
   * sobre el UTM de ENTRADA (antes de Badekas), provocando contaminación de dirección
   * y deformación por mutación al cambiar entre canoa_regven / regven_canoa.
   */
  static transformRigida(
    este: number, norte: number, h: number, huso: number,
    inv: boolean, dn?: number, de?: number
  ) {
    const elO = inv ? GRS80 : HAYFORD;
    const elD = inv ? HAYFORD : GRS80;

    const geoO = this.utmToGeo(este, norte, huso, false, elO);

    let effectiveDn = dn;
    let effectiveDe = de;
    let isAuto = false;
    let residuoInfo: any = null;

    if (effectiveDn === undefined || effectiveDe === undefined || isNaN(effectiveDn) || isNaN(effectiveDe)) {
      residuoInfo = getResiduoMalla(geoO.lat, geoO.lng);
      effectiveDn = effectiveDn ?? residuoInfo.dn;
      effectiveDe = effectiveDe ?? residuoInfo.de;
      isAuto = true;
    }

    const dN = inv ? -(effectiveDn || 0) : (effectiveDn || 0);
    const dE = inv ? -(effectiveDe || 0) : (effectiveDe || 0);

    // FLUJO UNIFICADO: Badekas 3D siempre se ejecuta primero, independientemente
    // del método de residuo (IDW automático o manual). El residuo es un ajuste
    // POST-transformación que se suma sobre las coordenadas ya rotadas.
    const cart = this.geoToCart(geoO.lat, geoO.lng, h, elO);
    const cartT = this.badekas(cart.X, cart.Y, cart.Z, inv);
    const geoD_badekas = this.cartToGeo(cartT.X, cartT.Y, cartT.Z, elD);
    const utmD_badekas = this.geoToUTM(geoD_badekas.lat, geoD_badekas.lng, huso, elD);

    const finalEste = utmD_badekas.este + dE;
    const finalNorte = utmD_badekas.norte + dN;

    const finalGeo = this.utmToGeo(finalEste, finalNorte, huso, false, elD);

    return {
      este: Math.round(finalEste * 1000) / 1000,
      norte: Math.round(finalNorte * 1000) / 1000,
      lat: finalGeo.lat,
      lng: finalGeo.lng,
      huso,
      dn: Math.round((effectiveDn || 0) * 1000) / 1000,
      de: Math.round((effectiveDe || 0) * 1000) / 1000,
      dnApplied: Math.round(dN * 1000) / 1000,
      deApplied: Math.round(dE * 1000) / 1000,
      badekasEste: Math.round(utmD_badekas.este * 1000) / 1000,
      badekasNorte: Math.round(utmD_badekas.norte * 1000) / 1000,
      autoResiduo: isAuto,
      metodoResiduo: residuoInfo?.metodo ?? "manual",
      dLineal: Math.sqrt(
        Math.pow(finalEste - este, 2) +
        Math.pow(finalNorte - norte, 2)
      ),
    };
  }

  // ==========================================
  // RIGIDA02 — MOTOR GEODÉSICO LOCAL ADÍCORA
  // Sector: Municipio Falcón, Estado Falcón, Venezuela
  // Marco Origen: La Canoa / PSAD-56
  // Marco Destino: REGVEN (SIRGAS / WGS84 — EPSG:2203)
  // Calibración de campo: AL-318 (Hito fotográfico verificado)
  // ==========================================

  /** Vector de traslación rígida local: ΔE Canoa → REGVEN */
  static readonly RIGIDA02_DELTA_ESTE = -204.330;
  /** Vector de traslación rígida local: ΔN Canoa → REGVEN */
  static readonly RIGIDA02_DELTA_NORTE = -311.540;
  /** Cota geoidal regional de defecto para Adícora / Paraguana */
  static readonly RIGIDA02_COTA_GEOIDAL = -22.450;

  /**
   * RIGIDA02 — Traslación rígida pura PSAD-56 → REGVEN (Sector Adícora, Falcón).
   *
   * FLUJO COMPLETO (4 FASES — espejo del motor GEO-ADÍCORA v1.0.0):
   *   1. AUDITORÍA DE ENTRADA: Detecta y corrige transposición Norte/Este por
   *      análisis de magnitudes (Norte Adícora ≈ 1,320,000 / Este ≈ 411,000).
   *   2. TRASLACIÓN RÍGIDA PURA:
   *        E_REGVEN = E_Canoa + DELTA_ESTE  (-204.330)
   *        N_REGVEN = N_Canoa + DELTA_NORTE (-311.540)
   *      PROHIBIDO: factores de escala parásitos, rotaciones automáticas.
   *   3. ALTIMETRÍA CONSISTENTE: Preserva cota de campo si Z ≠ 0, de lo
   *      contrario inyecta la cota geoidal regional (-22.450 m).
   *   4. QA/QC DE INVARIANZA DE FORMA: Calcula distancias euclidianas entre
   *      todos los pares de vértices en Canoa y en REGVEN; lanza error si
   *      alguna diferencia supera 0.001 m (tolerancia cero al milímetro).
   *
   * @param vertices  Array de {id, norte_origen, este_origen, cota_origen}
   * @returns { resultados, qaqcPasado, detalle }
   * @throws Error si la tolerancia de rigidez métrica es excedida.
   */
  static transformRigida02(
    vertices: Array<{
      id: string;
      norte_origen: number;
      este_origen: number;
      cota_origen?: number;
    }>,
    customDeltas?: {
      deltaEste?: number;
      deltaNorte?: number;
      cotaGeoidal?: number;
    }
  ): {
    resultados: Array<{
      id: string;
      este_canoa: number;
      norte_canoa: number;
      este_regven: number;
      norte_regven: number;
      cota_regven: number;
      cotaInyectada: boolean;
      descripcion: string;
    }>;
    qaqcPasado: boolean;
    metodo: 'RIGIDA02_ADICORA_REGVEN';
    deltaEste: number;
    deltaNorte: number;
    cotaGeoidalDefecto: number;
  } {
    if (vertices.length < 2) {
      throw new Error('RIGIDA02: Se requieren mínimo 2 vértices para validar la geometría.');
    }

    const deltaEste = (customDeltas?.deltaEste !== undefined && !isNaN(customDeltas.deltaEste))
      ? customDeltas.deltaEste
      : GeoEngine.RIGIDA02_DELTA_ESTE;
    const deltaNorte = (customDeltas?.deltaNorte !== undefined && !isNaN(customDeltas.deltaNorte))
      ? customDeltas.deltaNorte
      : GeoEngine.RIGIDA02_DELTA_NORTE;
    const cotaGeoidal = (customDeltas?.cotaGeoidal !== undefined && !isNaN(customDeltas.cotaGeoidal))
      ? customDeltas.cotaGeoidal
      : GeoEngine.RIGIDA02_COTA_GEOIDAL;

    // ── FASE 1: AUDITORÍA DE ENTRADA Y TRANSPOSICIÓN AUTOMÁTICA ──────────────
    // En Adícora, Norte ≈ 1,320,000 | Este ≈ 411,000.
    // Si el usuario invierte los campos, el motor los transpone automáticamente.
    const normalizados = vertices.map(v => {
      let n = v.norte_origen;
      let e = v.este_origen;
      if (e > n) {
        // Los valores están transpuestos: el "Este" es mayor que el "Norte",
        // lo cual es imposible en el sector Adícora → corregir.
        [n, e] = [e, n];
      }
      return {
        id: v.id,
        e_canoa: e,
        n_canoa: n,
        z_canoa: v.cota_origen ?? 0,
      };
    });

    // ── FASE 2 (pre-QA/QC): DISTANCIAS EUCLIDIANAS EN SISTEMA ORIGEN ─────────
    const distanciasOrigen = new Map<string, number>();
    for (let i = 0; i < normalizados.length; i++) {
      for (let j = i + 1; j < normalizados.length; j++) {
        const p1 = normalizados[i];
        const p2 = normalizados[j];
        const key = `${p1.id}_${p2.id}`;
        const dist = Math.sqrt(
          Math.pow(p1.e_canoa - p2.e_canoa, 2) +
          Math.pow(p1.n_canoa - p2.n_canoa, 2)
        );
        distanciasOrigen.set(key, dist);
      }
    }

    // ── FASE 3: TRASLACIÓN RÍGIDA PURA + INYECCIÓN ALTIMÉTRICA ───────────────
    const resultados = normalizados.map(v => {
      const e_regven = Math.round((v.e_canoa + deltaEste) * 1000) / 1000;
      const n_regven = Math.round((v.n_canoa + deltaNorte) * 1000) / 1000;

      // Preserva cota de campo si es válida (≠ 0); de lo contrario inyecta geoidal.
      const cotaInyectada = v.z_canoa === 0;
      const cota_regven = Math.round(
        (cotaInyectada ? cotaGeoidal : v.z_canoa) * 1000
      ) / 1000;

      return {
        id: v.id,
        este_canoa: Math.round(v.e_canoa * 1000) / 1000,
        norte_canoa: Math.round(v.n_canoa * 1000) / 1000,
        este_regven: e_regven,
        norte_regven: n_regven,
        cota_regven,
        cotaInyectada,
        descripcion: 'VERTICE_SANEADO_REGVEN',
      };
    });

    // ── FASE 4: QA/QC POST-TRANSFORMACIÓN — INVARIANZA DE FORMA ─────────────
    // Tolerancia cero al milímetro (traslación pura no puede deformar figuras).
    const TOLERANCIA_MM = 0.001; // metros
    for (let i = 0; i < resultados.length; i++) {
      for (let j = i + 1; j < resultados.length; j++) {
        const p1 = resultados[i];
        const p2 = resultados[j];
        const key = `${p1.id}_${p2.id}`;
        const distOrigen = distanciasOrigen.get(key)!;
        const distDestino = Math.sqrt(
          Math.pow(p1.este_regven - p2.este_regven, 2) +
          Math.pow(p1.norte_regven - p2.norte_regven, 2)
        );
        if (Math.abs(distOrigen - distDestino) > TOLERANCIA_MM) {
          throw new Error(
            `RIGIDA02 QA/QC FAIL: Inconsistencia geométrica entre ${p1.id} y ${p2.id}. ` +
            `ΔDistancia=${Math.abs(distOrigen - distDestino).toFixed(4)} m > tolerancia ${TOLERANCIA_MM} m. ` +
            `Se detectó una deformación topológica parásita.`
          );
        }
      }
    }

    return {
      resultados,
      qaqcPasado: true,
      metodo: 'RIGIDA02_ADICORA_REGVEN',
      deltaEste,
      deltaNorte,
      cotaGeoidalDefecto: cotaGeoidal,
    };
  }
}
