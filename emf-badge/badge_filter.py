# Part of the simulation scripts behind https://slopswap.org/emf-badge/
# Needs Python 3 with numpy, and ngspice on the PATH (written against ngspice 42).
# Keep the badge_*.py files in one folder; netlists and results go into an ng/ folder beside them.
# Run:  python3 badge_filter.py [tone|pitch|hiss|reverse]   (no argument runs all four; about ten minutes)
"""Filtering the sound while tuning. Two filters: a capacitor in series with the switch's path to the amplifier (a high-pass
against mains hum) and a larger feedback capacitor (a low-pass). Also a chopper that reverses the coil instead of grounding it,
which cancels the hum without a filter. The hum is 60, 180 and 300 Hz induced in the coil alongside a 40 kHz field."""
import numpy as np, sys
from badge_core import *
import badge_hiss as H
HUM = 0.5e-3                     # volts of each hum frequency induced in the coil: about 0.1 V of each at the stock output
HUMSRC = 'VH1 nh1 0 SINE(0 %g 60)\nVH2 nh2 nh1 SINE(0 %g 180)\nVH3 nh3 nh2 SINE(0 %g 300)\nVEMF n1 nh3 SINE' % (HUM, HUM, HUM)
def body(mid, cf='100p', cser=None, lo=None, hum=True, flo=39e3):
    b = front(0.05, 40e3, mid, c1=cser)
    if hum: b = b.replace('VEMF n1 0 SINE', HUMSRC)
    assert 'CF out n6 100p' in b; b = b.replace('CF out n6 100p', 'CF out n6 ' + cf)
    return b + (lo or 'VLO lo 0 1.5')
def levels(name, b, freqs, tend=0.15, win=0.05):
    d = run(name, b, '.tran 0.25u %g %g 0.25u' % (tend, tend - win)); t, v = d[:, 0], d[:, 1]
    return [tone(t, v, f)[0]*1e3 for f in freqs], v.min(), v.max()
def noise(name, make):
    """the op-amp's own noise at the output, 300 Hz to 15 kHz: the difference of a run with the noise source and one without"""
    outs = []
    for tag, nz in (('q', (0.0, H.NT)), ('n', (H.NA, H.NT))):
        d = run(name + '_' + tag, make(nz), '.tran 0.25u 60m 2m 0.25u', opts='.options reltol=1e-4 abstol=1e-13 vntol=1e-8'); outs.append(H.uni(d, 60e-3)[1])
    n = min(len(outs[0]), len(outs[1])); return H.band_rms(outs[1][:n] - outs[0][:n])
def single(cf, cser, lo):
    return lambda nz: front(0, 40e3, spdt() if lo else direct(), c1=cser, vos='0', noise=nz).replace('CF out n6 100p', 'CF out n6 ' + cf) + (lo or 'VLO lo 0 1.5')
def reversing(lo, src='L1 n2 q 100m', nz=None):
    """both ends of the coil on switch sections: p to the amplifier and q to 0 V for half the cycle, then the other way round"""
    plus = ('VNZ n7 n7b dc 0 trnoise(%g %g 0 0)\nVOS n7b 0 0' % nz) if nz else 'VOS n7 0 1m'
    return f"""{src}
RDCR p n2 250
CPA p 0 15p
CPB q 0 15p
RD lo lod 1k
CD lod 0 {60e-9/1e3:g}
S1 p b lod 0 SWP
S2 p 0 0 lod SWP
S3 q 0 lod 0 SWP
S4 q b 0 lod SWP
.model SWP SW(Ron=120 Roff=1G Vt=0.4 Vh=0.05)
RIN n6 b 100
XU1 n7 n6 vp vn out NJM2115
RF out n6 100k
CF out n6 100p
{plus}
VPOS vp 0 {{vs}}
VNEG 0 vn {{vs}}
""" + lo
LO = lo_src(39e3)
CASES = [('stock badge, normal', 'f_stock', direct(), '100p', None, None),
         ('switch held at pass, normal', 'f_pass', spdt(), '100p', None, None),
         ('pass with 0.22u in series', 'f_pass_220n', spdt(), '100p', '220n', None),
         ('tuned, no filter', 'f_tuned', spdt(), '100p', None, LO),
         ('tuned, 0.47u in series', 'f_c470n', spdt(), '100p', '470n', LO),
         ('tuned, 0.22u in series', 'f_c220n', spdt(), '100p', '220n', LO),
         ('tuned, 0.1u in series', 'f_c100n', spdt(), '100p', '100n', LO),
         ('tuned, feedback 100p + 390p', 'f_cf490', spdt(), '490p', None, LO),
         ('tuned, 0.22u and 390p', 'f_both', spdt(), '490p', '220n', LO)]
if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if which in ('all', 'tone'):
        print('%-30s %8s %8s %8s %8s %8s   %s' % ('', '1 kHz', '60 Hz', '180 Hz', '300 Hz', '39 kHz', 'output swing'))
        for label, name, mid, cf, cser, lo in CASES:
            r, lo_v, hi_v = levels(name, body(mid, cf, cser, lo), (1000, 60, 180, 300, 39e3))
            print('%-30s %5.1f mV %5.1f mV %5.1f mV %5.1f mV %5.1f mV   %+.2f .. %+.2f V' % (label, *r, lo_v, hi_v))
    if which in ('all', 'pitch'):
        print('size of the tone against its pitch (40 kHz field, no hum), mV at 150, 300, 600, 1k, 2k, 4k and 8k Hz')
        for label, cf, cser in [('no filter', '100p', None), ('0.22u in series', '100p', '220n'), ('0.1u in series', '100p', '100n'), ('390p feedback', '490p', None), ('0.22u and 390p', '490p', '220n')]:
            row = [levels('fp_%s_%d' % (label.replace(' ', '').replace('.', ''), p), body(spdt(), cf, cser, lo_src(40e3 - p), hum=False), (p,), tend=0.06, win=0.04)[0][0] for p in (150, 300, 600, 1000, 2000, 4000, 8000)]
            print('%-18s ' % label + ' '.join('%6.1f' % x for x in row))
    if which in ('all', 'hiss'):
        ref = noise('fh_stock', single('100p', None, None))
        for label, cf, cser, lo in [('tuned, no filter', '100p', None, LO), ('tuned, 0.22u in series', '100p', '220n', LO), ('tuned, feedback 100p + 390p', '490p', None, LO), ('tuned, 0.22u and 390p', '490p', '220n', LO)]:
            r = noise('fh_' + label.replace(' ', '').replace(',', '_').replace('.', ''), single(cf, cser, lo))
            print('%-30s hiss %6.3f mV rms, %+5.1f dB against the stock badge' % (label, r*1e3, 20*np.log10(r/ref)))
        r = noise('fh_reversing', lambda nz: reversing(LO, nz=nz))
        print('%-30s hiss %6.3f mV rms, %+5.1f dB against the stock badge' % ('reversing chopper', r*1e3, 20*np.log10(r/ref)))
    if which in ('all', 'reverse'):
        src = 'VH1 nh1 q SINE(0 %g 60)\nVH2 nh2 nh1 SINE(0 %g 180)\nVEMF n1 nh2 SINE(0 0.05 40000)\nL1 n2 n1 100m' % (HUM, HUM)
        for duty in (0.5, 0.42):
            r, lo_v, hi_v = levels('f_rev_%g' % duty, reversing(lo_src(39e3, duty), src), (1000, 60, 180, 39e3))
            print('reversing chopper, switch high %2.0f %% of the time: 1 kHz %5.1f mV   60 Hz %4.1f mV   180 Hz %4.1f mV   39 kHz %4.1f mV   %+.2f .. %+.2f V' % (duty*100, *r, lo_v, hi_v))
