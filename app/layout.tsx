import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import dns from 'dns';
import LoadingOverlay from '@/components/LoadingOverlay';
import ToasterProvider from '@/components/ToasterProvider';

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GeoGIS6 Mobile",
  description: "App Móvil Cartográfica y Transformación Geodésica La Canoa ↔ REGVEN",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${inter.className} antialiased`}>
        <LoadingOverlay />
        {children}
        <ToasterProvider />
      </body>
    </html>
  );
}
