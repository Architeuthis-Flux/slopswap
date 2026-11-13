# Part of the simulation scripts behind https://slopswap.org/emf-badge/
# Needs Python 3 with numpy, and ngspice on the PATH (written against ngspice 42).
# Keep the badge_*.py files in one folder; netlists and results go into an ng/ folder beside them.
# Run:  python3 badge_chop.py [spdt|top|shunt|comb]   (no argument runs all four; several minutes)
"""Chopper options at +/-1.5 V: SPDT section, FET shunt, NPN shunt; tuned and comb."""
import numpy as np, sys
from badge_core import *
def case(name, mid, fsig, flo, duty=0.5, vemf=None, c1='10u', vs=1.5, tend=40e-3, win=10e-3, step=0.25e-6):
    vemf = 0.05*fsig/40e3 if vemf is None else vemf          # same field strength at every frequency
    body = front(vemf, fsig, mid, c1=c1) + lo_src(flo, duty, vs)
    d = run(name, body, '.tran %g %g %g %g' % (step, tend, tend-win, step), vs=vs)
    t, v = d[:, 0], d[:, 1]
    return t, v
def report(name, mid, fsig, flo, n=1, **kw):
    t, v = case(name, mid, fsig, flo, **kw)
    beat = abs(fsig - n*flo); tn, dc = tone(t, v, beat); lk = tone(t, v, flo)[0]
    print('%-30s field %7.1fk  LO %6.1fk  note %5.0f Hz: %5.1f mV   DC %5.1f mV  out %5.2f..%5.2f V  LO leak %5.1f mV' % (name, fsig/1e3, flo/1e3, beat, tn*1e3, dc*1e3, v.min(), v.max(), lk*1e3))
    return tn
if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if which in ('all', 'spdt'):
        print('--- SPDT, one 74HC4053 section (120 ohm, 60 ns at 3 V) ---')
        report('spdt_40k', spdt(), 40e3, 39e3)
        report('spdt_200k', spdt(), 200e3, 199e3, step=0.1e-6, tend=30e-3)
        report('spdt_400k', spdt(), 400e3, 399e3, step=0.05e-6, tend=24e-3, win=8e-3)
        print('--- same at a flat battery: +/-1.0 V, 400 ohm, 150 ns ---')
        report('spdt_40k_2V', spdt(400, 150e-9), 40e3, 39e3, vs=1.0)
        report('spdt_200k_2V', spdt(400, 150e-9), 200e3, 199e3, vs=1.0, step=0.1e-6, tend=30e-3)
        print('--- no C1 (offset 1 mV, then 6 mV worst case) ---')
        report('spdt_40k_noC1', spdt(), 40e3, 39e3, c1=None)
    if which in ('all', 'top'):
        print('--- the stretched top of the dial: same section at 0.6, 0.8 and 1 MHz, fresh cells and then +/-1.0 V ---')
        for f in (600e3, 800e3, 1000e3):
            st = 0.025e-6 if f < 900e3 else 0.02e-6
            report('top_%dk' % (f/1e3), spdt(), f, f - 1e3, step=st, tend=16e-3, win=6e-3)
            report('top_%dk_2V' % (f/1e3), spdt(400, 150e-9), f, f - 1e3, vs=1.0, step=st, tend=16e-3, win=6e-3)
    if which in ('all', 'shunt'):
        print('--- shunt-only, one FET and a capacitor ---')
        report('fet_bss138_40k', shunt_fet('BSS138'), 40e3, 39e3, c1=None)
        report('fet_bss138_200k', shunt_fet('BSS138'), 200e3, 199e3, c1=None, step=0.1e-6, tend=30e-3)
        report('fet_bss138_40k_2V', shunt_fet('BSS138'), 40e3, 39e3, c1=None, vs=1.0)
        report('fet_2n7000_40k', shunt_fet('N7000'), 40e3, 39e3, c1=None)
        report('fet_2n7000_40k_2V', shunt_fet('N7000'), 40e3, 39e3, c1=None, vs=1.0)
        print('--- shunt-only, NPN and a capacitor ---')
        report('npn_40k', shunt_npn(), 40e3, 39e3, c1=None)
        report('npn_200k', shunt_npn(), 200e3, 199e3, c1=None, step=0.1e-6, tend=30e-3)
    if which in ('all', 'comb'):
        print('--- comb: SPDT passes for a 3 us pulse, LO 30 kHz (duty 0.09) ---')
        for nn, fs in ((1, 31e3), (2, 61e3), (5, 151e3), (8, 241e3), (10, 301e3)):
            pred = 0.05*100e3/(2*np.pi*40e3*0.1) * abs(np.sin(nn*np.pi*0.09))/(nn*np.pi)
            tn = report('comb_n%d' % nn, spdt(), fs, 30e3, n=nn, duty=0.09, step=0.1e-6, tend=30e-3)
            print('      predicted %.1f mV' % (pred*1e3))
