import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import LoadingOverlay from '@/components/LoadingOverlay';
import ToasterProvider from '@/components/ToasterProvider';

const inter = Inter({ subsets: ["latin"] });

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-stitch-headline",
  display: "swap",
});

const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-stitch-body",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-stitch-mono",
  display: "swap",
});

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
    <html
      lang="es"
      className={`dark ${spaceGrotesk.variable} ${hankenGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      <body className={`${inter.className} antialiased bg-[#0d1322] text-[#dde2f8]`}>
        <LoadingOverlay />
        {children}
        <ToasterProvider />
      </body>
    </html>
  );
}
