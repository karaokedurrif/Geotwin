import '@/styles/globals.css';
import 'leaflet/dist/leaflet.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import Script from 'next/script';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>GeoTwin Engine</title>
        <meta name="description" content="Interactive 3D geospatial twin platform" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <link
          rel="stylesheet"
          href="https://cesium.com/downloads/cesiumjs/releases/1.113/Build/Cesium/Widgets/widgets.css"
        />
      </Head>
      <Script
        src="https://cesium.com/downloads/cesiumjs/releases/1.113/Build/Cesium/Cesium.js"
        strategy="beforeInteractive"
      />
      <Component {...pageProps} />
    </>
  );
}
