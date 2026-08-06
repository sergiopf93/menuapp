"""
Genera los iconos PNG necesarios para la PWA a partir del SVG.
Ejecutar una vez en local: python docs/generar-iconos.py
Requiere: pip install cairosvg
"""
import cairosvg, os

sizes = [192, 512]
svg_path = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons', 'icon.svg')
out_dir  = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons')

for size in sizes:
    out = os.path.join(out_dir, f'icon-{size}.png')
    cairosvg.svg2png(url=svg_path, write_to=out, output_width=size, output_height=size)
    print(f'✓ Generado {out}')
