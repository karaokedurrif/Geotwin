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
      {/* Polyfill: guarantee performance.clearMarks/clearMeasures exist.
          Cesium 1.113 minified code (variable "mgt") calls clearMarks —
          some environments (SSR, workers) don't expose it, crashing the bundle. */}
      {/* Polyfill performance API + suppress Cesium 1.113 "mgt.clearMarks" crash.
          "mgt" is a minified Cesium-internal object — NOT window.performance.
          The only safe fix is a global error handler that catches this exact error
          so it doesn't stop rendering or pollute the console. */}
      <Script id="perf-polyfill" strategy="beforeInteractive">{`
        (function(){
          if(typeof performance!=='undefined'){
            if(typeof performance.clearMarks!=='function') performance.clearMarks=function(){};
            if(typeof performance.clearMeasures!=='function') performance.clearMeasures=function(){};
            if(typeof performance.mark!=='function') performance.mark=function(){};
            if(typeof performance.measure!=='function') performance.measure=function(){};
            if(typeof performance.getEntriesByName!=='function') performance.getEntriesByName=function(){return[]};
          }
          /* Catch Cesium minified "mgt.clearMarks is not a function" at global level */
          window.addEventListener('error', function(evt) {
            if (evt && evt.message && evt.message.indexOf('clearMarks') !== -1) {
              evt.preventDefault();
              return true;
            }
          });
          window.addEventListener('unhandledrejection', function(evt) {
            if (evt && evt.reason && String(evt.reason).indexOf('clearMarks') !== -1) {
              evt.preventDefault();
            }
          });
        })();
      `}</Script>
      <Script
        src="https://cesium.com/downloads/cesiumjs/releases/1.113/Build/Cesium/Cesium.js"
        strategy="beforeInteractive"
      />
      <Component {...pageProps} />
    </>
  );
}
