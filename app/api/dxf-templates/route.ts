import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import fs from 'fs';
import path from 'path';

const TEMPLATES_META_PATH = path.join(
  process.cwd(),
  'src/engines/geodesy/exporters/plantilla/templates_meta.json'
);
const TEMPLATES_DIRS = [
  path.join(process.cwd(), 'src/engines/geodesy/exporters/plantilla'),
  path.join(process.cwd(), 'plantilla'),
];

function resolveTemplateFile(filename: string): string | null {
  for (const dir of TEMPLATES_DIRS) {
    const fp = path.join(/*turbopackIgnore: true*/ dir, filename);
    if (fs.existsSync(/*turbopackIgnore: true*/ fp)) return fp;
  }
  return null;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  try {
    const raw = fs.readFileSync(TEMPLATES_META_PATH, 'utf-8');
    const templates = JSON.parse(raw);

    const available = templates.filter((t: any) => {
      if (!t.file) return false;
      return resolveTemplateFile(t.file) !== null;
    });

    return NextResponse.json({ templates: available });
  } catch {
    return NextResponse.json({ templates: [] });
  }
}
