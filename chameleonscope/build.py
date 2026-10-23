#!/usr/bin/env python3
"""Builds two files from src/:
  dist/trenchlight_feed.html          full standalone document (open locally: live data)
  dist/trenchlight_feed.artifact.html body-only version for the claude.ai Artifact tool
"""
import pathlib
ROOT = pathlib.Path(__file__).parent
SRC = ROOT / 'src'
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)

# v1.43: the Trading bot tab (and About, Roadmap, the gate) are pages of their own; their markup and styles live in src/panel_*.{html,css} and (v1.94: the Mint NFT tab is gone)
# are stitched in here (the <!--PANELS--> marker in body.html sits right after the embedded tabs)
css = '\n'.join((SRC / n).read_text(encoding='utf-8') for n in ['styles.css', 'panel_bot.css', 'panel_public.css', 'theme.css', 'portal.css', 'quantum.css'])  # v2.10: the relaunch skin and the portal come last, over the old rules; v2.20: the quantum layer over all of them
panels = '\n'.join((SRC / n).read_text(encoding='utf-8') for n in ['panel_bot.html', 'panel_public.html'])
body = (SRC / 'body.html').read_text(encoding='utf-8')
assert body.count('<!--PANELS-->') == 1, 'body.html needs one <!--PANELS--> marker'
body = body.replace('<!--PANELS-->', panels)
# v2.10: the portal, the dark place the domain opens on (src/portal.html), sits before everything else
assert body.count('<!--PORTAL-->') == 1, 'body.html needs one <!--PORTAL--> marker'
body = body.replace('<!--PORTAL-->', (SRC / 'portal.html').read_text(encoding='utf-8'))
js = '\n'.join((SRC / n).read_text(encoding='utf-8') for n in ['demo_logos.js', 'demo_data.js', 'app_core.js', 'app_calls.js', 'app_account.js', 'demo_flow.js', 'app_sources.js', 'app_quantum.js', 'app_gmgn.js', 'app_ui.js', 'app_xray.js', 'app_smart.js', 'app_known.js', 'app_bottab.js', 'app_portal.js', 'app_gate.js'])

FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' \
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">'

head_common = '<title>|CHAMELEON\u27e9 · the quantum memecoin radar</title>\n' + FONTS + '\n<style>\n' + css + '\n</style>\n'
# v1.36: the version and the build time, shown in the Data sources panel so a new file can be told from the old one at a glance
VERSION = '2.24'
import datetime
BUILT = datetime.datetime.now(datetime.timezone.utc).strftime('%d %b %Y, %H:%M UTC')
stamp = "window.TL_BUILD = { version: '" + VERSION + "', built: '" + BUILT + "' };\n"
# the bundle must parse: one stray comment can take the whole page down, and a syntax error shows nothing but a blank feed
import subprocess, shutil, tempfile, os, re
if shutil.which('node'):
    tmp = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8'); tmp.write(js); tmp.close()
    r = subprocess.run(['node', '--check', tmp.name], capture_output=True, text=True); os.unlink(tmp.name)
    if r.returncode != 0:
        raise SystemExit('BUILD REFUSED: the script bundle does not parse\n' + r.stderr[-1500:])
# v1.94: the page ships without comments. The notes in the code (the server, the history of every rule) stay in src/; the
# visitor's copy carries none. terser only drops the comments and the spacing: no renaming, no rewriting, the
# code runs as written. Without terser (npm i -g terser) the build keeps the comments and says so
def strip_js(code):
    t = shutil.which('terser')
    if not t:
        print('note: terser not found (npm i -g terser): the page keeps the code comments'); return code
    r = subprocess.run([t, '--format', 'comments=false'], input=code, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('BUILD REFUSED: terser could not read the bundle\n' + r.stderr[-1500:])
    return r.stdout
body = re.sub(r'<!--[\s\S]*?-->', '', body)
head_common = head_common.replace(css, re.sub(r'/\*[\s\S]*?\*/', '', css))  # the styles' notes go too
scripts = '<script>\n' + stamp + strip_js(js) + '\n</script>\n'  # the stamp stays as written: a deploy script can read the version from it

# v1.35: a tab icon and the cards a link unfurls into (X, Telegram): the same chameleon, one line of description
FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='5 8 57 54'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23b7f35a'/%3E%3Cstop offset='.48' stop-color='%232ee6c5'/%3E%3Cstop offset='1' stop-color='%239d7bff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M39.5 29.8c-2.2-.7-4.6-1-7-.6-6.2.9-11.1 4.8-13.2 9.6-5.3 1.7-9.2 5.9-9.9 10.7-.8 5.4 2.6 9.8 7.5 10 4.5.2 7.8-3.3 7.4-7.6-.3-3.4-3-5.4-5.7-4.4-2.1.7-3.2 2.7-2.6 4.6.4 1.4 1.8 2.2 3 1.8 1-.3 1.4-1.3 1.1-2.1' fill='none' stroke='url(%23g)' stroke-width='4.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M59 29c-1.5-2.4-4-4.6-6.7-5.8-2.3-4.6-5.5-8.8-8.9-11.4-1-.8-2.4 0-2.3 1.2.4 4.2-.5 8-2.5 11.2-2 3.2-1.4 6.2 1.8 8.2 4 2.5 13 1.2 18.6-3.4z' fill='url(%23g)'/%3E%3Ccircle cx='50' cy='27.5' r='4' fill='%230b110f'/%3E%3Ccircle cx='51.4' cy='27.5' r='1.7' fill='url(%23g)'/%3E%3C/svg%3E"
SOCIAL = ('<meta name="theme-color" content="#06061a">\n<link rel="icon" href="' + FAVICON + '">\n'
          '<meta property="og:type" content="website"><meta property="og:title" content="|CHAMELEON\u27e9: the quantum memecoin radar"><meta property="og:description" content="Every coin in the trenches is in superposition until you observe it. Live launches on Solana and Robinhood Chain with rug checks, calls at the cap they were made at, and a live radar for the quantum narrative: every quantum, quant and qubit coin on Solana the moment it moves. Analytics only, no trading.">\n'
          '<meta name="twitter:card" content="summary"><meta name="twitter:title" content="|CHAMELEON\u27e9: the quantum memecoin radar"><meta name="twitter:description" content="Live launches with rug checks, calls at the cap they were made at, and a radar for the hottest coins on the quantum narrative.">\n')
full = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="description" content="|CHAMELEON\u27e9: a quantum memecoin terminal for Solana and Robinhood Chain. Trenches feed, Smart Tracking and the Quantum radar. Analytics only, no trading.">\n'
        + SOCIAL + head_common + '</head>\n<body>\n' + body + '\n' + scripts + '</body>\n</html>\n')
artifact = head_common + body + '\n' + scripts

(DIST / 'trenchlight_feed.html').write_text(full, encoding='utf-8')
(DIST / 'trenchlight_feed.artifact.html').write_text(artifact, encoding='utf-8')
print('v' + VERSION + ' built ' + BUILT + '; full:', len(full) // 1024, 'KB; artifact:', len(artifact) // 1024, 'KB')
