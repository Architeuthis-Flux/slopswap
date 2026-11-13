# Part of the simulation scripts behind https://slopswap.org/emf-badge/
# Needs Python 3 with numpy, and ngspice on the PATH (written against ngspice 42).
# Keep the badge_*.py files in one folder; netlists and results go into an ng/ folder beside them.
# Run:  python3 badge_hiss.py   (fourteen long transient runs; several minutes)
"""Hiss: the op-amp's own input noise at the output, 300 Hz to 15 kHz, for each way of chopping, relative to the stock badge.
Each case is run twice, with and without a white noise source in series with the op-amp's + input (300 nV/rtHz, so that it
dominates numerical error; only ratios are used). The difference of the two runs is the response to the noise alone."""
import numpy as np, sys
from badge_core import *
EN = 300e-9; NT = 1e-6; NA = EN*np.sqrt(1/(2*NT)); FS = 500e3
def uni(d, t1):
    tu = np.arange(2e-3, t1, 1/FS); return tu, np.interp(tu, d[:, 0], d[:, 1])
def band_rms(x, f0=300, f1=15e3):
    w = np.hanning(len(x)); X = np.fft.rfft((x - x.mean())*w); f = np.fft.rfftfreq(len(x), 1/FS); m = (f >= f0) & (f <= f1)
    return float(np.sqrt(2*(np.abs(X[m])**2).sum()/((w**2).sum()*len(x))))
def case(name, mid, lo=None, c1='10u', tend=60e-3, vos='0'):
    outs = []
    for tag, nz in (('q', (0.0, NT)), ('n', (NA, NT))):
        body = front(0, 40e3, mid, c1=c1, vos=vos, noise=nz) + (lo or 'VLO lo 0 1.5')
        d = run(name + '_' + tag, body, '.tran 0.25u %g 2m 0.25u' % tend, opts='.options reltol=1e-4 abstol=1e-13 vntol=1e-8')
        outs.append(uni(d, tend)[1])
    n = min(len(outs[0]), len(outs[1])); q = outs[0][:n]; nn = outs[1][:n]
    return band_rms(nn - q), band_rms(q), float(np.abs(nn).max())
if __name__ == '__main__':
    cases = [('stock badge', 'h_stock', direct(), None, None),
             ('SPDT held at pass (C1 10u, 120 ohm)', 'h_spdt_pass', spdt(), None, '10u'),
             ('SPDT chopping at 39 kHz', 'h_spdt_chop', spdt(), lo_src(39e3), '10u'),
             ('SPDT chopping, no C1', 'h_spdt_chop_noc1', spdt(), lo_src(39e3), None),
             ('SPDT comb, 3 us at 30 kHz', 'h_spdt_comb', spdt(), lo_src(30e3, 0.09), '10u'),
             ('FET shunt chopping at 39 kHz', 'h_fet_chop', shunt_fet(), lo_src(39e3), None),
             ('NPN shunt chopping at 39 kHz', 'h_npn_chop', shunt_npn(), lo_src(39e3), None)]
    ref = None
    for label, name, mid, lo, c1 in cases:
        r, quiet, pk = case(name, mid, lo, c1)
        if ref is None: ref = r
        print('%-38s noise %7.3f mV rms  %+6.1f dB re stock   (run without noise: %.3f mV in band, peak out %.2f V)' % (label, r*1e3, 20*np.log10(r/ref), quiet*1e3, pk))
