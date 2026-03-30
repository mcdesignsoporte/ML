ML Rutas Optimizer
==================

Contenido:
- index.html  -> app lista para abrir en navegador o subir a GitHub Pages
- README.txt  -> instrucciones rápidas

Uso local:
1. Descomprime el ZIP.
2. Abre index.html en Chrome o Edge.
3. Para captura de pantalla, permite el acceso cuando el navegador lo pida.
4. Sube capturas o comparte pantalla.
5. Corre OCR, corrige direcciones, geocodifica y abre bloques en Google Maps.

Subir a GitHub Pages:
1. Crea un repositorio nuevo en GitHub.
2. Sube index.html a la raíz del repo.
3. Ve a Settings > Pages.
4. En Build and deployment elige Deploy from a branch.
5. Selecciona la rama main y la carpeta /(root).
6. Guarda y abre la URL que te da GitHub Pages.

Notas:
- La app usa Tesseract.js desde CDN.
- La geocodificación usa OpenStreetMap Nominatim.
- La optimización actual es una heurística simple de vecino más cercano.
- Si quieres, luego te la convierto a versión Vite con package.json y estructura /src.
