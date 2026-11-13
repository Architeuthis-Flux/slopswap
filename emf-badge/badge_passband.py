# Part of the simulation scripts behind https://slopswap.org/emf-badge/
# Needs Python 3 with numpy, and ngspice on the PATH (written against ngspice 42).
# Keep the badge_*.py files in one folder; netlists and results go into an ng/ folder beside them.
# Run:  python3 badge_passband.py
"""NORMAL mode (switch held to the amplifier): how C1 and the switch's on-resistance change the badge's
ordinary audio response.  AC analysis, ratio to the stock stage."""
import subprocess, numpy as np, os
W = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ng'); os.makedirs(W, exist_ok=True)
OP = """.subckt NJM2115 inp inn vp vn out
G1 0 x inp inn 1m
R1 x 0 10Meg
C1 x 0 13.26p
E1 o 0 x 0 1
R2 o out 50
.ends NJM2115
"""
def run(name, c1, ron):
    mid = 'RSW A B %g\n' % max(ron, 1e-3)
    mid += ('C1 B N5 %s\n' % c1) if c1 else 'RC1 B N5 1m\n'
    txt = f"""* {name}
VEMF N1 0 AC 1
L1 N2 N1 100m
RDCR A N2 250
CPAR A 0 30p
{mid}RIN N6 N5 100
XU1 0 N6 VP VN OUT NJM2115
RF OUT N6 100k
CF OUT N6 100p
VPOS VP 0 1.5
VNEG 0 VN 1.5
{OP}
.control
ac dec 40 20 20k
wrdata {os.path.join(W, name)}.dat vm(out)
.endc
.end
"""
    open(os.path.join(W, name + '.cir'), 'w').write(txt)
    subprocess.run(['ngspice', '-b', os.path.join(W, name + '.cir')], capture_output=True, text=True)
    d = np.loadtxt(os.path.join(W, name + '.dat')); return d[:, 0], d[:, 1]
f, stock = run('stock', None, 0)
rows = [('no C1, 120 ohm', None, 120), ('no C1, 400 ohm', None, 400), ('no C1, 6 ohm', None, 6), ('C1 1u, 120 ohm', '1u', 120), ('C1 10u, 120 ohm', '10u', 120), ('C1 10u, 50 ohm', '10u', 50)]
pts = [60, 120, 180, 300, 500, 1000, 2000, 5000, 10000]
print('%-18s' % 'dB vs stock at Hz' + ''.join('%8d' % p for p in pts))
for name, c1, ron in rows:
    _, v = run('pass_' + name.replace(' ', '').replace(',', '_'), c1, ron)
    r = 20 * np.log10(v / stock)
    print('%-18s' % name + ''.join('%8.1f' % np.interp(np.log(p), np.log(f), r) for p in pts))
