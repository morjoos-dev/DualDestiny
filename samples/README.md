# Muestras de código

Una selección de archivos reales de **Dual Destiny** para enseñar cómo está hecho. Son piezas de un proyecto más grande
(el resto del código, el servidor y los recursos son privados), así que no compilan por separado: están para leerse.

| Archivo | Qué es | Por qué es interesante |
|---|---|---|
| [`unity/DemoDirector.cs`](unity/DemoDirector.cs) | **Modo director** del cliente | Con `-guion archivo.txt` el juego sigue un guion (teclas simuladas con el Input System, habilidades, comandos del chat) y se graba a sí mismo: cámara propia a un `RenderTexture`, `AsyncGPUReadback` y fotogramas en bruto enviados a ffmpeg por un hilo aparte. Funciona en segundo plano, sin interfaz. Así se grabaron todos los GIFs de este repositorio. |
| [`unity/NetworkPlayer.Shadow.cs`](unity/NetworkPlayer.Shadow.cs) | Rasgo **Paso de sombra** (servidor autoritativo) | Un rasgo completo de rango F a S sobre Mirror: teletransporte con cargas, ocultarse, puñaladas críticas, marcas que ralentizan, señuelo y Danza de sombras. El cliente solo pide; el servidor valida, decide y sincroniza. |
| [`servidor/skillShapes.js`](servidor/skillShapes.js) | **Habilidades por piezas** (Node.js) | Una habilidad es una *forma* (proyectil, rayo, línea, área, golpe…) más una lista de *efectos* (daño, veneno, ralentizar, curar, invocar…). Este módulo define y valida las piezas que el panel de administración combina sin tocar código. |
| [`herramientas/music_gen.js`](herramientas/music_gen.js) | **Sintetizador y secuenciador de música** | Toda la música del juego sale de aquí: osciladores, envolventes, instrumentos sintetizados, reverberación y un secuenciador por compases. Los temas se renderizan en bucle perfecto (la cola de reverberación se suma al principio). Sin muestras ni licencias. |
| [`herramientas/pasarela.js`](herramientas/pasarela.js) | **Generador de la pasarela de la web** | Lee las hojas de sprites del juego, extrae la animación de andar, recorta cada personaje a la altura de los pies para que todos pisen la misma línea y genera las tiras y el CSS con la separación calculada según el ancho de cada uno. |

---

© Todos los derechos reservados. El código se muestra solo para consulta: no se concede licencia de uso, copia ni
distribución.
