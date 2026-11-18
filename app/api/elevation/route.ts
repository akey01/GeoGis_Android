import { NextRequest, NextResponse } from 'next/server';

interface LocationInput {
  lat: number;
  lng: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const locations: LocationInput[] = body.locations || body.points || [];

    if (!Array.isArray(locations) || locations.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere un arreglo de ubicaciones [{lat, lng}, ...]' },
        { status: 400 }
      );
    }

    // Filtrar y validar coordenadas
    const validLocations = locations.map(loc => ({
      lat: Number(loc.lat),
      lng: Number(loc.lng)
    }));

    const invalidIndex = validLocations.findIndex(
      loc => !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng) ||
             loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180
    );

    if (invalidIndex !== -1) {
      return NextResponse.json(
        { error: `Coordenada inválida en índice ${invalidIndex}` },
        { status: 400 }
      );
    }

    // ── PROVEEDOR 1: Google Maps Elevation API (Si hay clave) ──
    const googleKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
    if (googleKey.trim()) {
      try {
        const pathParam = validLocations.map(l => `${l.lat},${l.lng}`).join('|');
        const googleUrl = `https://maps.googleapis.com/maps/api/elevation/json?locations=${encodeURIComponent(pathParam)}&key=${googleKey.trim()}`;
        
        const googleRes = await fetch(googleUrl, { signal: AbortSignal.timeout(6000) });
        if (googleRes.ok) {
          const data = await googleRes.json();
          if (data.status === 'OK' && Array.isArray(data.results)) {
            const elevations = data.results.map((r: any) => Number(r.elevation ?? 0));
            return NextResponse.json({
              success: true,
              source: 'Google Earth / Maps Elevation API',
              elevations
            });
          }
        }
      } catch (err) {
        console.warn('[Elevation API] Google Elevation falló, intentando proveedor DEM de respaldo...', err);
      }
    }

    // ── PROVEEDOR 2: Open-Meteo DEM (Copernicus 30m / SRTM 30m) ──
    try {
      const lats = validLocations.map(l => l.lat.toFixed(6)).join(',');
      const lngs = validLocations.map(l => l.lng.toFixed(6)).join(',');
      const openMeteoUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;

      const res = await fetch(openMeteoUrl, { signal: AbortSignal.timeout(7000) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.elevation)) {
          const elevations = data.elevation.map((e: any) => Number(e ?? 0));
          return NextResponse.json({
            success: true,
            source: 'Satelital DEM (Copernicus / SRTM 30m)',
            elevations
          });
        }
      }
    } catch (err) {
      console.warn('[Elevation API] Open-Meteo DEM falló, intentando Open-Elevation...', err);
    }

    // ── PROVEEDOR 3: Open-Elevation API Fallback ──
    try {
      const openElevationUrl = 'https://api.open-elevation.com/api/v1/lookup';
      const res = await fetch(openElevationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          locations: validLocations.map(l => ({ latitude: l.lat, longitude: l.lng }))
        }),
        signal: AbortSignal.timeout(8000)
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.results)) {
          const elevations = data.results.map((r: any) => Number(r.elevation ?? 0));
          return NextResponse.json({
            success: true,
            source: 'Open-Elevation DEM',
            elevations
          });
        }
      }
    } catch (err) {
      console.warn('[Elevation API] Open-Elevation falló:', err);
    }

    // Si todos fallan por conexión de red o timeout, retornar ceros con código 200 para no romper la exportación
    return NextResponse.json({
      success: false,
      source: 'Fallback Offline',
      elevations: validLocations.map(() => 0),
      message: 'No se pudo conectar a los servicios de elevación satelital en este momento'
    });

  } catch (error: any) {
    console.error('[Elevation API Route Error]:', error);
    return NextResponse.json(
      { error: 'Error interno al consultar elevaciones satelitales', details: error.message },
      { status: 500 }
    );
  }
}
