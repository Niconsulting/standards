#!/usr/bin/env python3
"""Packt das Spiel in eine einzige HTML-Datei.

  python3 tools/bundle.py              -> Wuestenfeste.html (komplett, zum Doppelklicken)
  python3 tools/bundle.py --fragment X -> nur Inhalt ohne <html>/<head>/<body> nach X
"""
import re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'style.css').read_text(encoding='utf-8')
scripts = re.findall(r'<script src="(js/[^"]+)"></script>', html)
js = '\n'.join((root / s).read_text(encoding='utf-8') for s in scripts)
body = html.split('<!--BODY-START-->')[1].split('<!--BODY-END-->')[0]
fonts = re.search(r'<link rel="stylesheet" href="(https://fonts[^"]+)">', html).group(1)
js = js.replace('</script', '<\\/script')

if len(sys.argv) > 2 and sys.argv[1] == '--fragment':
    out = ('<title>Wüstenfeste</title>\n'
           '<link rel="stylesheet" href="' + fonts + '">\n'
           '<style>\n' + css + '\n</style>\n' + body + '\n<script>\n' + js + '\n</script>\n')
    pathlib.Path(sys.argv[2]).write_text(out, encoding='utf-8')
else:
    out = html.split('<!--BODY-START-->')[0]
    out = out.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
    out += body + '\n<script>\n' + js + '\n</script>\n</body>\n</html>\n'
    (root / 'Wuestenfeste.html').write_text(out, encoding='utf-8')
print('ok', len(out) // 1024, 'KB')
