Actúa como un Arquitecto de Software Senior especializado en gráficos web. Necesito diseñar la arquitectura de una aplicación web que sea un Visor y Editor de modelos 3D (estilo Sketchfab).
Requisitos técnicos:
Motor 3D: Utiliza Three.js con WebGL.
Frontend: React (o Next.js) para la interfaz del editor.
Estado: Zustand o Redux para sincronizar los parámetros de la UI (luces, materiales, post-procesado) con la escena 3D.
Formato: Soporte nativo para archivos glTF/GLB.
Por favor, genera:
Una estructura de carpetas modular (separando la lógica del motor 3D de los componentes de React).
Un Diagrama de Flujo de Datos que explique cómo un cambio en un 'slider' de la UI actualiza un material en el modelo 3D en tiempo real.
Un ejemplo de Clase 'Viewer' (Patrón Singleton o Custom Hook) que encapsule la escena, la cámara y el renderizador de Three.js.
Una lista de librerías esenciales (ej. @react-three/fiber, @react-three/drei para simplificar la integración)."

1. El Motor de Renderizado (El "Visor")
Para que se vea como Sketchfab, no basta con cargar el modelo; necesitas Iluminación Basada en Imágenes (IBL) y un Pipeline de Post-procesado.
Usaremos React Three Fiber (R3F) porque permite declarar la escena 3D como componentes de React, lo que facilita enormemente la creación de un editor.
Instala estas dependencias:
bash
npm install three @types/three @react-three/fiber @react-three/drei
Usa el código con precaución.

Estructura del componente Viewer.jsx:
javascript
import { Canvas } from '@react-three/fiber'
import { Stage, OrbitControls, useGLTF, Environment } from '@react-three/drei'
import { Suspense } from 'react'

function Model({ url }) {
  const { scene } = useGLTF(url)
  return <primitive object={scene} castShadow receiveShadow />
}

export const Viewer = ({ modelUrl, environment }) => {
  return (
    <Canvas shadows camera={{ position: [0, 0, 5], fov: 45 }}>
      <Suspense fallback={null}>
        {/* Stage maneja luces automáticas y sombras promediadas */}
        <Stage intensity={0.5} environment={environment} contactShadow={{ opacity: 0.7, blur: 2 }}>
          <Model url={modelUrl} />
        </Stage>
        <Environment preset={environment} background />
      </Suspense>
      <OrbitControls makeDefault />
    </Canvas>
  )
}
Usa el código con precaución.

2. Manejo de Subida de Archivos (El "Cargador")
Sketchfab procesa los modelos en el servidor, pero para un editor moderno, lo ideal es que el usuario vea su modelo instantáneamente en el navegador antes de subirlo.
Lógica para leer archivos locales sin servidor (Client-side Preview):
javascript
const handleFileUpload = (event) => {
  const file = event.target.files[0];
  if (file) {
    // Creamos una URL temporal del archivo local
    const url = URL.createObjectURL(file);
    // Esta URL se la pasas al componente <Model url={url} />
    setModelPath(url); 
  }
};
Usa el código con precaución.

3. Sincronización UI-Motor (El "Editor")
Aquí es donde conectas los "sliders" de la interfaz con el modelo 3D. Te recomiendo usar Zustand porque es extremadamente rápido para actualizaciones de 60fps.
Estado global (store.js):
javascript
import { create } from 'zustand'

export const useEditorStore = create((set) => ({
  intensity: 0.5,
  environment: 'city',
  setIntensity: (val) => set({ intensity: val }),
  setEnvironment: (env) => set({ environment: env }),
}))


Tu siguiente paso estratégico:
Para que el editor sea realmente útil, necesitas acceder a los materiales internos del modelo cargado para cambiarles el color o la rugosidad.


Para que tu editor sea funcional, necesitas "abrir" el modelo GLTF y extraer sus materiales. Así, cuando el usuario haga clic en una parte del objeto, tu interfaz de React sabrá qué propiedad cambiar (color, rugosidad, metalicidad).
Aquí tienes la lógica para mapear los materiales y el componente para editarlos:
1. El Hook para extraer materiales automáticamente
Este componente recorre el árbol de nodos del modelo 3D y extrae una lista única de materiales para que puedas listarlos en tu UI.
javascript
import { useGLTF } from '@react-three/drei'
import { useMemo } from 'react'

export function ModelWithEditor({ url, config }) {
  const { scene } = useGLTF(url)

  // Memorizamos los materiales para no recalcular en cada render
  const materials = useMemo(() => {
    const items = {}
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        items[obj.material.name] = obj.material
      }
    })
    return items
  }, [scene])

  // Aplicar cambios desde la UI (ejemplo: cambiar color de un material específico)
  if (materials[config.activeMaterialName]) {
    materials[config.activeMaterialName].color.set(config.color)
    materials[config.activeMaterialName].roughness = config.roughness
  }

  return <primitive object={scene} />
}


2. Panel de Control (UI) con Leva
En lugar de crear sliders desde cero con CSS, te recomiendo usar Leva. Es la librería estándar para prototipar editores 3D en React rápidamente.
bash
npm install leva
Usa el código con precaución.

Uso en tu componente principal:
javascript
import { useControls } from 'leva'

export function App() {
  // Esto crea automáticamente un panel flotante con controles
  const { color, roughness, intensity } = useControls({
    color: '#ff0000',
    roughness: { value: 0.5, min: 0, max: 1 },
    intensity: { value: 1, min: 0, max: 5 }
  })

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Viewer>
         <ModelWithEditor 
           url="/modelo.glb" 
           config={{ color, roughness }} 
         />
         <ambientLight intensity={intensity} />
      </Viewer>
    </div>
  )
}


3. El "Toque Sketchfab": Post-Procesado
Para que el visor no se vea "plano" y parezca profesional, añade efectos de lente. Usa @react-three/postprocessing:
javascript
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing'

// Dentro de tu <Canvas>
<EffectComposer>
  <Bloom luminanceThreshold={1} mipmapBlur intensity={0.5} />
  <Vignette eskil={false} offset={0.1} darkness={1.1} />
</EffectComposer>
Usa el código con precaución.

Resumen de Arquitectura Final:
Capa de Datos: Un archivo .glb (cargado localmente con URL.createObjectURL).
Capa de Estado: Zustand o Leva para manejar las variables (color, luz).
Capa de Render: Three.js (vía React Three Fiber) aplicando esas variables a los materiales del modelo.
