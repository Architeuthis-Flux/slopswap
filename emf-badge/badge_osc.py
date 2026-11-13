# Part of the simulation scripts behind https://slopswap.org/emf-badge/
# Needs Python 3 with numpy, and ngspice on the PATH (written against ngspice 42).
# Keep the badge_*.py files in one folder; netlists and results go into an ng/ folder beside them.
# Run:  python3 badge_osc.py
"""Oscillator options on the badge's 3 V (and at a flat 2 V): frequency range over the pot, duty cycle, supply current.
Logic rails here are 0..VCC (the badge's -1.5 and +1.5)."""
import numpy as np, subprocess, os, sys
from badge_core import W, MODELS
def ng(name, txt, tran, saves):
    out = os.path.join(W, name + '.dat'); p = os.path.join(W, name + '.cir')
    open(p, 'w').write('* %s\n%s\n%s\n%s\n.control\nset wr_singlescale\nrun\nwrdata %s %s\n.endc\n.end\n' % (name, txt, MODELS, tran, out, ' '.join(saves)))
    r = subprocess.run(['ngspice', '-b', p], capture_output=True, text=True, timeout=600)
    log = r.stdout + r.stderr
    if 'rror' in log and 'no. of' not in log.lower(): print('   !!', name, [l for l in log.splitlines() if 'rror' in l][:2])
    return np.loadtxt(out)
def fd(t, v, th):
    """frequency and duty (fraction of time above th) from the last few cycles"""
    up = np.where((v[:-1] < th) & (v[1:] >= th))[0]; dn = np.where((v[:-1] >= th) & (v[1:] < th))[0]
    if len(up) < 4: return 0.0, 0.0
    tx = lambda i: t[i] + (th - v[i])*(t[i+1]-t[i])/(v[i+1]-v[i])
    u = np.array([tx(i) for i in up[-4:]]); per = (u[-1]-u[0])/3
    d = [tx(i) for i in dn if u[-2] < tx(i) < u[-1]]
    return 1/per, ((d[0]-u[-2])/per if d else 0.0)
def schmitt(vcc, vtp, vtn, rout=150, delay=40e-9):
    """inverting Schmitt gate 'in' -> 'out' with real thresholds, output resistance and delay"""
    return f"""SSM q 0 in 0 SMT
RQ vcc q 10k
BQ qb 0 V = v(q)
RDL qb qd 1k
CDL qd 0 {delay/1e3/0.69:g}
BO oi 0 V = {vcc}*(0.5+0.5*tanh(40*(v(qd)-{vcc/2})))
RO oi out {rout}
.model SMT SW(Ron=1 Roff=1G Vt={(vtp+vtn)/2} Vh={(vtp-vtn)/2})"""
def hc14(vcc, rpot, c='330p', rfix='10k'):
    vtp, vtn = {3.0: (1.66, 0.87), 2.0: (1.18, 0.52)}[vcc]
    return f"VCC vcc 0 {vcc}\n" + schmitt(vcc, vtp, vtn) + f"\nRT out in {{{rfix}+{rpot}}}\nCT in 0 {c}\nCIN in 0 5p\n.ic v(in)=0"
def t555(vcc, rpot, c='330p', rfix='10k', comb=False, rb='13k'):
    """CMOS 555 with TRIG and THRES tied to the capacitor ('in'). Tuned: timing R from OUT. Comb: RA from VCC to DIS, RB from DIS to the capacitor."""
    core = f"VCC vcc 0 {vcc}\n" + schmitt(vcc, 2*vcc/3, vcc/3, rout=400, delay=250e-9) + f"\nCT in 0 {c}\nCIN in 0 3p\n.ic v(in)=0"
    if not comb: return core + f"\nRT out in {{{rfix}+{rpot}}}"
    return core + f"\nRA vcc dis {{{rfix}+{rpot}}}\nRB dis in {rb}\nBNQ nq 0 V = {vcc}-v(qd)\nSDIS dis 0 nq 0 SDM\n.model SDM SW(Ron=150 Roff=1G Vt={vcc/2} Vh=0.1)\nRLOAD out 0 1Meg"
def twoinv(vcc, rpot, c='180p', rfix='10k', rs='47k', comb=False, rd='15k'):
    """two 74HC4053 sections wired as inverters (throws to the rails): the classic two-gate RC oscillator"""
    inv = lambda a, b, n: f"""BI{n} oi{n} 0 V = {vcc}*(0.5-0.5*tanh(60*(v({a}d)-{vcc/2})))
BB{n} {a}b 0 V = v({a})
RDI{n} {a}b {a}d 1k
CDI{n} {a}d 0 {60e-9/1e3/0.69:g}
RO{n} oi{n} {b} 150"""
    txt = f"VCC vcc 0 {vcc}\n" + inv('g1', 'o1', 1) + '\n' + inv('o1', 'o2', 2) + f"""
RT o1 n {{{rfix}+{rpot}}}
CT o2 n {c}
RS n g1 {rs}
RX o2 out 1m
CG g1 0 3.5p
DP1 g1 vcc DCLAMP
DP2 0 g1 DCLAMP
.model DCLAMP D(Is=1e-14 Rs=100 Cjo=1p)
.ic v(n)=0 v(g1)=0"""
    if comb: txt += f"\nDC1 o1 nd D4148\nRDC nd n {rd}\n.model D4148 D(Is=2.5n Rs=0.6 N=1.75 Cjo=1p Tt=4n)"
    return txt
def astable(vcc, rpot, c='100p', rb='22k', rc='4.7k', comb=False, rb2='4.7k'):
    """two-transistor multivibrator; both base resistors return to the positive rail through the one pot"""
    return f"""VCC vcc 0 {vcc}
RC1 vcc c1 {rc}
RC2 vcc out {rc}
Q1 c1 b1 0 Q3904
Q2 out b2 0 Q3904
C1 c1 b2 {c}
C2 out b1 {c}
RB1 p b1 {rb if not comb else rb2}
RB2 p b2 {rb}
RP vcc p {{1+{rpot}}}
CL out 0 5p
.ic v(c1)=0.1 v(out)={vcc} v(b1)=0.65 v(b2)=-1"""
def sweep(label, fn, vccs=(3.0, 2.0), pots=(0, 25e3, 50e3, 100e3), tran='.tran 20n 1.2m 0.6m 20n', th=None, **kw):
    for vcc in vccs:
        row = []
        for rp in pots:
            d = ng('osc_%s_%g_%g' % (label.split()[0], vcc, rp), fn(vcc, rp, **kw), tran, ('v(out)', 'i(VCC)'))
            f, du = fd(d[:, 0], d[:, 1], vcc/2 if th is None else th)
            row.append('%6.1f kHz %2.0f%% %4.2f us %4.2f mA' % (f/1e3, du*100, ((1-du)/f*1e6 if f else 0), -d[:, 2].mean()*1e3))
        print('%-38s VCC %.0f V | ' % (label, vcc) + ' | '.join(row))
if __name__ == '__main__':
    print('pot at:                                      0            25k            50k            100k   (frequency, share of the time the output is high, time low, supply current)')
    print('supply current means something only for the transistor pair; the other three are threshold models with no supply path')
    sweep('hc14 74HC14 gate, 10k, 330p', hc14)
    sweep('t555 CMOS 555 tuned, 220p', t555, c='220p')
    sweep('t555c CMOS 555 comb, 220p, RB 18k', t555, c='220p', comb=True, rb='18k')
    sweep('twoinv two 4053 sections, 180p', twoinv)
    sweep('twoinvc same with the comb diode, 15k', twoinv, comb=True)
    sweep('ast two 2N3904, 100p, 22k, 4.7k', astable)
    sweep('astc same as a comb, 4.7k on one base', astable, comb=True)
