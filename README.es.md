[![CI](https://github.com/zidell/ginote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/zidell/ginote/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/zidell/ginote/branch/main/graph/badge.svg)](https://codecov.io/gh/zidell/ginote)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Italiano](README.it.md) | **Español**

# Ginote

## Acerca de

Ginote es una app web sencilla y segura que te permite usar GitHub Issues como notas
personales. Personalmente me gustan los GitHub Issues, pero su lentitud y su UX incómoda
siempre me molestaron. Así que creé una SPA que conserva casi todas sus funciones, pero
con la experiencia de uso de una app de notas. La app está formada solo por JS estático
y el navegador se comunica directamente con la API de GitHub, por eso es segura.

App en línea (cualquiera puede usarla gratis): [https://note.gitools.net](https://note.gitools.net)

## Vista previa

![Vista previa de Ginote](docs/preview.gif)

Cómo volver a generar el GIF de vista previa se explica en [docs/screencasting.md](docs/screencasting.md).

## Características

- **Guardado directo en un repositorio privado:** los Issues de un repositorio privado
  funcionan como notas, sin servidor ni base de datos propios de la app.
- **Conexión directa desde el navegador:** el navegador llama directamente a la API de
  GitHub. No hay ningún servidor intermedio del operador de la app que reciba o guarde
  tus notas o tu PAT.
- **Etiquetas, búsqueda y papelera:** las etiquetas (labels) de GitHub se usan como
  etiquetas (cada una puede llevar una descripción), con búsqueda en el contenido y una
  papelera basada en los Issues cerrados. Las notas que consultas a menudo se pueden fijar
  arriba.
- **Comentarios:** los comentarios de los Issues sirven como entradas de seguimiento de
  una nota. También puedes adjuntar archivos a los comentarios o dictarlos por voz.
- **Adjuntos de archivos e imágenes:** los adjuntos de notas y comentarios se guardan en
  el mismo repositorio y se pueden ver tanto en la app como en GitHub. Consulta
  [cómo se guardan los adjuntos](docs/ATTACHMENTS.md) para más detalles.
- **Grabación de voz, transcripción y pulido (solo OpenAI):** el audio grabado en el
  navegador se transcribe directamente con OpenAI, y la transcripción se puede pulir hasta
  convertirla en un texto escrito natural. En ese paso también se puede generar un título
  y recibir sugerencias de etiquetas existentes; si hace falta, el audio original se
  conserva como adjunto de la nota. Por ahora, las funciones de voz solo admiten la API
  de OpenAI.
- **Bloqueo de notas (cifrado adicional):** si un repositorio privado no te basta,
  bloquea una nota con un código de 6 dígitos para cifrar una vez más su cuerpo y sus
  comentarios en el navegador con AES-GCM. Consulta
  [cómo funciona el cifrado](docs/ENCRYPTION.md) para más detalles.
- **Herramientas de edición:** combina varias notas en una, busca y reemplaza en el
  cuerpo (con soporte para expresiones regulares) y consulta el resultado renderizado en
  el visor de Markdown.
- **Varios repositorios:** registra varios repositorios y cambia entre ellos desde la
  lista o con las teclas numéricas.
- **Control con el teclado:** recorrer, abrir y seleccionar notas, crear notas nuevas y
  cambiar de repositorio, todo desde el teclado.
- **Integración con MCP:** si conectas el servidor MCP oficial de GitHub, tus
  herramientas de IA también pueden leer y escribir las mismas notas (Issues). No hace
  falta ningún servidor MCP propio de la app.
- **Web y escritorio:** disponible como PWA instalable y como apps para macOS, Windows y
  Linux basadas en Tauri. Para el empaquetado y las versiones de la app de escritorio,
  consulta la [documentación de la app de escritorio](docs/DESKTOP.md).

## Uso

### ¿Adónde van mis datos?

**Ginote es una app web estática que se distribuye como archivos.** El servidor de
alojamiento solo entrega los archivos de la app, como HTML, CSS y JavaScript. No hay
ningún backend que gestione el inicio de sesión ni el guardado de notas: una vez abierta
la app, todo el tráfico de datos va directamente entre tu navegador y la API de GitHub.

```text
Tu navegador  ←──── conexión directa ────→  GitHub
     │
     └─ El PAT, los ajustes y los borradores sin guardar se quedan solo en este navegador
```

- Las notas, etiquetas y adjuntos se guardan solo en el repositorio de GitHub que
  indiques.
- Tu PAT y los ajustes de la app se guardan solo en tu navegador y se envían a la API de
  GitHub únicamente para la autenticación.
- Los borradores sin guardar se quedan solo en ese navegador.
- El cifrado opcional de notas se describe en [cómo funciona el cifrado](docs/ENCRYPTION.md).
- No existe ninguna API que envíe notas, PAT o ajustes al operador de la app, y no se
  usa ningún servicio de analítica ni de seguimiento.

En resumen, aparte de las solicitudes para descargar los archivos de la app, ninguno de
tus datos se envía al operador de la app ni a ningún servidor que no sea GitHub. Tus
notas solo existen realmente **en tu propio navegador y en el repositorio de GitHub que
elegiste**.

### Usar la grabación de voz

Antes de usar la grabación de voz por primera vez necesitas una clave de API de OpenAI.
Crea una clave de API en OpenAI e introdúcela en Ginote en
**Ajustes → Grabación de voz → Clave de API de OpenAI**. OpenAI puede cobrarte según el
uso que hagas de la API.

Una vez configurada, empieza a grabar con el botón del micrófono de la barra lateral o de
la vista de la nota. Al terminar, el audio se transcribe y después se aplican el modelo y
las reglas de pulido (opcionales) para proponer el cuerpo, el título y etiquetas
existentes. En los ajustes puedes cambiar el modelo de transcripción, el modelo de
pulido y el vocabulario frecuente para la transcripción; si dejas vacío el modelo de
pulido, solo se guarda la transcripción. Si activas **Conservar el audio original**, el
audio de las grabaciones correctas también se guarda como adjunto de esa nota.

Los archivos de audio y las transcripciones se envían directamente del navegador a la API
de OpenAI, sin pasar por ningún servidor de la app. La clave de API se guarda en texto
plano en el `localStorage` del navegador de este dispositivo, así que úsala solo en
dispositivos personales. Recomendamos una clave de proyecto exclusiva, límites de uso y
rotarla con regularidad.

### Atajos de teclado

En la lista de notas están disponibles los siguientes atajos. Mientras escribes en un
campo de texto, los atajos de la lista no funcionan. `Ctrl/Cmd + R` es el atajo de
recarga del navegador, así que recarga la app desde cualquier lugar.

| Tecla | Acción |
| --- | --- |
| `↑` / `↓` | Moverse por la lista de notas |
| `Enter` | Abrir la nota actual · pulsar de nuevo para editar |
| `N` | Crear una nota nueva |
| `` ` `` | Abrir el selector de repositorios |
| `1`–`9` | Cambiar de repositorio en el orden de registro |
| `Esc` | Quitar la selección · cancelar la eliminación · cerrar la ayuda |
| `Space` | Seleccionar la nota actual |
| `Shift` + `↑` / `↓` | Seleccionar un rango de notas |
| `Delete` / `Backspace` | Mover las notas seleccionadas a la papelera |
| `Ctrl/Cmd + R` | Recargar la app |

Con una nota abierta y sin ningún campo de texto enfocado, también puedes usar estos
atajos.

| Tecla | Acción |
| --- | --- |
| `T` | Añadir una etiqueta |
| `A` | Adjuntar un archivo |
| `P` | Fijar arriba / desfijar |
| `L` | Bloquear · desbloquear |
| `Delete` | Mover la nota a la papelera |
| `G` | Ver el Issue en GitHub |
| `M` | Abrir · cerrar el visor MD |
| `R` | Recargar toda la app |
| `S` | Guardar la nota actual |

### PWA (app web instalable)

Las builds de producción funcionan como una PWA que puedes instalar desde el navegador y
usar como una app. Abre la app en línea en tu navegador y usa su menú de instalación. El
manifiesto y el service worker no dependen de ningún dominio ni servicio de alojamiento
concreto y funcionan en relación con la ruta donde se despliega la app. El service
worker (la función que permite al navegador conservar temporalmente los archivos de la
app) solo almacena en caché archivos del mismo origen que la app, nunca solicitudes a la
API de GitHub, el PAT ni los datos de las notas.

### Descargar la app de escritorio

Los instaladores para macOS, Windows y Linux están disponibles en
[GitHub Releases](https://github.com/zidell/ginote/releases). macOS usa un DMG y
Windows 10/11 un MSI. Las nuevas versiones para Windows se publicarán como MSI firmados
una vez configurada la firma con SignPath Foundation. La app de escritorio abre
[note.gitools.net](https://note.gitools.net) y necesita conexión a Internet. Los cambios
en la interfaz y en las funciones generales se aplican mediante despliegues web.

[Code signing policy](docs/CODE_SIGNING.md)

La instalación con Homebrew en macOS, la ejecución en local, el empaquetado por
plataforma y el proceso de publicación se describen en la
[documentación de la app de escritorio](docs/DESKTOP.md).

## Operación y desarrollo

Al modificar la app web, instala las dependencias a partir del archivo de bloqueo y
asegúrate de que las comprobaciones estáticas, las pruebas y la build de producción
pasen antes de desplegar. La app se despliega como archivos estáticos, y el empaquetado
y la firma de la app de escritorio se gestionan por separado del despliegue web. Los
cambios que afecten al formato de los datos o a la seguridad deben revisarse primero
contra la documentación de adjuntos y cifrado. El entorno de desarrollo, los comandos de
verificación y los procedimientos de despliegue y mantenimiento se describen en la
[documentación de desarrollo y operación](docs/DEVELOPMENT.md).

## Solicitudes de funciones

Si quieres una función nueva, haz un fork del proyecto y cámbialo tú mismo. Para lo que
yo necesito ya es suficiente, así que no acepto propuestas de funciones.

## Licencia

[MIT License](LICENSE)
