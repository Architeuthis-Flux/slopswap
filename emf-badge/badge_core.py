# Part of the simulation scripts behind https://slopswap.org/emf-badge/
# Needs Python 3 with numpy, and ngspice on the PATH (written against ngspice 42).
# Keep the badge_*.py files in one folder; netlists and results go into an ng/ folder beside them.
"""Production-circuit simulations for the EMF badge tuning knob, at the badge's own +/-1.5 V rails.
Everything is referred to the badge's 0 V (battery midpoint); logic swings -1.5..+1.5 V."""
import subprocess, numpy as np, os
D = os.path.dirname(os.path.abspath(__file__)); W = os.path.join(D, 'ng'); os.makedirs(W, exist_ok=True)
OP = """.subckt NJM2115 inp inn vp vn out
G1 0 x inp inn 1m
R1 x 0 10Meg
C1 x 0 13.26p
E2 hi 0 vp 0 1
E3 lo 0 vn 0 1
V2 hi hc 0.3
V3 lc lo 0.3
D1 x hc DCL
D2 lc x DCL
E1 o 0 x 0 1
R2 o out 50
.model DCL D(Is=1e-12 N=0.1)
.ends NJM2115
"""
MODELS = """.model BSS138 VDMOS(Vto=1.3 Kp=0.25 Rd=0.8 Rs=0.8 Rg=10 Cgdmax=8p Cgdmin=2p Cgs=25p Cjo=12p Is=1e-13 Rb=1)
.model N7000 VDMOS(Vto=2.1 Kp=0.2 Rd=0.7 Rs=0.7 Rg=10 Cgdmax=12p Cgdmin=3p Cgs=20p Cjo=20p Is=1e-13 Rb=1)
.model Q3904 NPN(Is=6.734f Xti=3 Eg=1.11 Vaf=74.03 Bf=416.4 Ne=1.259 Ise=6.734f Ikf=66.78m Xtb=1.5 Br=.7371 Nc=2 Isc=0 Ikr=0 Rc=1 Cjc=3.638p Mjc=.3085 Vjc=.75 Fc=.5 Cje=4.493p Mje=.2593 Vje=.75 Tr=239.5n Tf=301.2p Itf=.4 Vtf=4 Xtf=2 Rb=10)
"""
def front(vemf, fsig, mid, c1='10u', vos='1m', noise=None, extra_src=''):
    """coil -> [mid block: node a (coil) to node b (amplifier side)] -> C1 -> 100R -> op-amp"""
    c1line = ('C1 b n5 %s' % c1) if c1 else 'RC1 b n5 1m'
    nz = ('VNZ n7 n7b dc 0 trnoise(%g %g 0 0)\nVOS n7b 0 %s' % (noise[0], noise[1], vos)) if noise else ('VOS n7 0 %s' % vos)
    return f"""VEMF n1 0 SINE(0 {vemf} {fsig})
{extra_src}
L1 n2 n1 100m
RDCR a n2 250
CPAR a 0 30p
{mid}
{c1line}
RIN n6 n5 100
XU1 n7 n6 vp vn out NJM2115
RF out n6 100k
CF out n6 100p
{nz}
VPOS vp 0 {{vs}}
VNEG 0 vn {{vs}}
"""
def lo_src(flo, duty=0.5, vs=1.5, tr=15e-9, name='lo'):
    per = 1/flo
    return 'VLO %s 0 PULSE(%g %g 0 %g %g %g %g)' % (name, -vs, vs, tr, tr, duty*per - tr, per)
def spdt(ron=120, delay=60e-9, cft='2p'):
    """one 74HC4053 section: a = common, b = Y (amplifier side), X = 0 V. select 'lo' high = pass. break-before-make."""
    return f"""RD lo lod 1k
CD lod 0 {delay/1e3:g}
S1 a b lod 0 SWP
S2 a 0 0 lod SWP
CFa lo a {cft}
CFb lo b {cft}
.model SWP SW(Ron={ron} Roff=1G Vt=0.4 Vh=0.05)"""
def shunt_fet(model='BSS138', cs='1u', rg='1k'):
    """shunt-only chopper: FET + series cap from the coil/100R junction to the negative rail. gate high = shunt. a and b are the same node."""
    return f"""RJ a b 1m
CS a d {cs}
M1 d g vn {model}
RG lo g {rg}
RPD g vn 100k"""
def shunt_npn(cs='1u', rb='10k'):
    return f"""RJ a b 1m
CS a d {cs}
Q1 d bq vn Q3904
RB lo bq {rb}"""
def direct():
    return 'RJ a b 1m'
def run(name, body, tran, saves=('out',), vs=1.5, opts=''):
    out = os.path.join(W, name + '.dat')
    txt = '* ' + name + '\n' + body.replace('{vs}', '%g' % vs) + '\n' + OP + MODELS + opts + '\n' + tran + '\n.control\nset wr_singlescale\nrun\nwrdata %s %s\n.endc\n.end\n' % (out, ' '.join('v(%s)' % s for s in saves))
    p = os.path.join(W, name + '.cir'); open(p, 'w').write(txt)
    r = subprocess.run(['ngspice', '-b', p], capture_output=True, text=True, timeout=1500)
    log = r.stdout + r.stderr; open(os.path.join(W, name + '.log'), 'w').write(log)
    bad = [l for l in log.splitlines() if ('rror' in l or 'singular' in l or 'aborted' in l) and 'no. of' not in l.lower()]
    if bad: print('  !!', name, bad[:2])
    return np.loadtxt(out)
def tone(t, v, f):
    A = np.c_[np.sin(2*np.pi*f*t), np.cos(2*np.pi*f*t), np.ones_like(t)]
    w = np.gradient(t); c = np.linalg.lstsq(A*w[:, None]**0.5, v*w**0.5, rcond=None)[0]
    return float(np.hypot(c[0], c[1])), float(c[2])
