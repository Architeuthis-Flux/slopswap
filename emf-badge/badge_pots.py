# Part of the simulation scripts behind https://slopswap.org/emf-badge/
# Needs Python 3 with numpy, and ngspice on the PATH (written against ngspice 42).
# Keep the badge_*.py files in one folder; netlists and results go into an ng/ folder beside them.
# Run:  python3 badge_pots.py
"""The 74HC14 gate oscillator with pots from 100 k down to 10 k: the fixed resistor and the capacitor are scaled so the
range stays put. The gate's output resistance is a parameter, because it starts to matter once the fixed resistor is 1 k."""
from badge_osc import ng, fd, schmitt
TH = {3.0: (1.66, 0.87), 2.0: (1.18, 0.52)}          # 74HC14 thresholds, read from the datasheet at 3 V and at 2 V
def net(vcc, r, c, rout):
    vtp, vtn = TH[vcc]
    return f"VCC vcc 0 {vcc}\n" + schmitt(vcc, vtp, vtn, rout=rout) + f"\nRT out in {r:g}\nCT in 0 {c:g}\nCIN in 0 5p\n.ic v(in)=0"
def freq(tag, vcc, r, c, rout):
    d = ng(tag, net(vcc, r, c, rout), '.tran 20n 1.2m 0.6m 20n', ('v(out)', 'i(VCC)'))
    return fd(d[:, 0], d[:, 1], vcc/2)[0]/1e3
CASES = [('100k pot, 10k, 330p', 100e3, 10e3, 330e-12), ('50k pot, 4.7k, 680p', 50e3, 4.7e3, 680e-12), ('20k pot, 2k, 1.5n', 20e3, 2e3, 1.5e-9),
         ('10k pot, 1k, 3.3n', 10e3, 1e3, 3.3e-9), ('10k pot, 2.2k, 1.5n', 10e3, 2.2e3, 1.5e-9)]
if __name__ == '__main__':
    print('kHz at the top, middle and bottom of the pot, gate output resistance 150 ohm')
    for i, (label, rp, rs, c) in enumerate(CASES):
        row = ['%6.1f %6.1f %6.1f' % tuple(freq('pot%d_%g_%g' % (i, vcc, x), vcc, rs + rp*x, c, 150) for x in (0, 0.5, 1)) for vcc in (3.0, 2.0)]
        print('%-22s 3 V: %s   2 V: %s' % (label, row[0], row[1]))
    print('10k pot, 1k, 3.3n at 2 V with 400 ohm of gate output resistance: top %.1f kHz' % freq('pot_r400', 2.0, 1e3, 3.3e-9, 400))
    for tol in (0.7, 1.3):
        print('10k pot at %+d %%: bottom of the range %.1f kHz at 3 V' % (round((tol-1)*100), freq('pot_tol%g' % tol, 3.0, 1e3 + 10e3*tol, 3.3e-9, 150)))
