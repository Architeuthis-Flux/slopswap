# Part of the simulation scripts behind https://slopswap.org/emf-badge/
# Needs Python 3 with numpy, and ngspice on the PATH (written against ngspice 42).
# Keep the badge_*.py files in one folder; netlists and results go into an ng/ folder beside them.
# Run:  python3 badge_noresistor.py [pass|chop|hiss]   (no argument runs all three; several minutes)
"""What changes if the badge's 100 ohm input resistor is left out, so that the 74HC4053's own resistance is all that
stands between the coil and the amplifier.  pass: ordinary sound in normal listening.  chop: the tuned note, the comb and the
output offset.  hiss: the amplifier's noise."""
import sys, os, subprocess, numpy as np
import badge_core, badge_chop, badge_hiss
from badge_core import spdt, direct, lo_src, tone
orig = badge_core.front
def with_rin(rin):
    f = lambda *a, **k: orig(*a, **k).replace('RIN n6 n5 100', 'RIN n6 n5 %s' % rin)
    badge_chop.front = f; badge_hiss.front = f
W = badge_core.W
def ac(name, rin, ron):
    txt = f"""* {name}
VEMF N1 0 AC 1
L1 N2 N1 100m
RDCR A N2 250
CPAR A 0 30p
RSW A B {max(ron, 1e-3):g}
RIN N6 B {max(rin, 1e-3):g}
XU1 0 N6 VP VN OUT NJM2115
RF OUT N6 100k
CF OUT N6 100p
VPOS VP 0 1.5
VNEG 0 VN 1.5
.subckt NJM2115 inp inn vp vn out
G1 0 x inp inn 1m
R1 x 0 10Meg
C1 x 0 13.26p
E1 o 0 x 0 1
R2 o out 50
.ends NJM2115
.control
ac dec 40 20 20k
wrdata {os.path.join(W, name)}.dat vm(out)
.endc
.end
"""
    open(os.path.join(W, name + '.cir'), 'w').write(txt); subprocess.run(['ngspice', '-b', os.path.join(W, name + '.cir')], capture_output=True, text=True)
    d = np.loadtxt(os.path.join(W, name + '.dat')); return d[:, 0], d[:, 1]
which = sys.argv[1] if len(sys.argv) > 1 else 'all'
if which in ('all', 'pass'):
    f, stock = ac('nr_stock', 100, 0); pts = [60, 120, 180, 300, 500, 1000, 2000, 5000, 10000]
    print('NORMAL through the chip, dB against the stock badge, at Hz' + ''.join('%7d' % p for p in pts))
    for lab, rin, ron in (('100 ohm kept, chip 120', 100, 120), ('100 ohm kept, chip 400', 100, 400), ('no resistor, chip 70', 0, 70), ('no resistor, chip 120', 0, 120), ('no resistor, chip 200', 0, 200), ('no resistor, chip 400', 0, 400), ('no resistor, direct wire (bypass)', 0, 0)):
        _, v = ac('nr_' + lab.replace(' ', '').replace(',', '_').replace('(', '').replace(')', ''), rin, ron); r = 20*np.log10(v/stock)
        print('%-58s' % lab + ''.join('%7.1f' % np.interp(np.log(p), np.log(f), r) for p in pts))
if which in ('all', 'chop'):
    for rin in ('100', '1m'):
        with_rin(rin); tag = 'R100' if rin == '100' else 'R0'
        print('--- input resistor', rin, '---')
        badge_chop.report('nr_%s_40k' % tag, spdt(), 40e3, 39e3, c1=None)
        badge_chop.report('nr_%s_40k_2V' % tag, spdt(400, 150e-9), 40e3, 39e3, c1=None, vs=1.0)
        badge_chop.report('nr_%s_200k' % tag, spdt(), 200e3, 199e3, c1=None, step=0.1e-6, tend=30e-3)
        badge_chop.report('nr_%s_800k' % tag, spdt(), 800e3, 799e3, c1=None, step=0.025e-6, tend=16e-3, win=6e-3)
        badge_chop.report('nr_%s_comb' % tag, spdt(), 151e3, 30e3, n=5, duty=0.09, c1=None)
if which in ('all', 'hiss'):
    ref = None
    for lab, rin, name, mid, lo in (('stock badge', '100', 'nrh_stock', direct(), None), ('chip held at pass, 100 ohm kept', '100', 'nrh_pass_r', spdt(), None), ('chip held at pass, no resistor', '1m', 'nrh_pass_0', spdt(), None),
                                     ('chopping at 39 kHz, 100 ohm kept', '100', 'nrh_chop_r', spdt(), lo_src(39e3)), ('chopping at 39 kHz, no resistor', '1m', 'nrh_chop_0', spdt(), lo_src(39e3)),
                                     ('comb, 100 ohm kept', '100', 'nrh_comb_r', spdt(), lo_src(30e3, 0.09)), ('comb, no resistor', '1m', 'nrh_comb_0', spdt(), lo_src(30e3, 0.09))):
        with_rin(rin); r, quiet, pk = badge_hiss.case(name, mid, lo, None)
        if ref is None: ref = r
        print('%-36s noise %7.3f mV rms  %+6.1f dB re stock   (no-noise run: %.3f mV in band, peak %.2f V)' % (lab, r*1e3, 20*np.log10(r/ref), quiet*1e3, pk), flush=True)
