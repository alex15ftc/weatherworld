// The cloud model (roblox/src/cloudlab/shared/Model/CloudModel.luau and Nest.luau) in C, built to
// WebAssembly for the storm workers beside the engine (js/cloudmodel, docs/cloudlab/PLAN.md C2,
// option B). A line-for-line port: the same sums in the same order on 1-based arrays laid out like
// the Luau's, so the two can be compared value for value. The Luau stays the reference and the
// Studio lab's model; a change to one must go into the other (check: tools/cloudlab/native/bench.mjs and tools/cloudlab/worker/bench.luau print the same checksums).
//
// The JavaScript side (js/cloudmodel/CloudModel.js) builds the base state's profiles from the
// sounding, steers the run (EngineRun.js) and reads the fields straight from this module's memory.
// Build: tools/cloudlab/native/build.sh
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define EXPORT(name) __attribute__((export_name(#name)))

#define G 9.81
#define CP 1004.0
#define RD 287.04
#define RV 461.5
#define LV 2.5e6
#define P00 1e5
#define LF 3.34e5
#define RHOH 900.0
#define KA 2.43e-2
#define DV 2.26e-5
#define NU 1.5e-5
#define N0R 8e6
#define N0S 3e6
#define RHOS 100.0
#define SC 11.72
#define SD 0.41
#define G4SD 10.276
#define G3SD 3.013
#define G5SD2 1.551
#define LS 2.834e6
#define HOMO_C -40.0
#define GLAC_S 300.0
#define KAPPA (RD / CP)
static const double PI = 3.141592653589793;

static double FOLLOW_Z = 4000, FOLLOW_W = 5, COLD_K = 1, COLD_TOP = 1500, FEED_MARGIN = 2, RECENTRE_MAX = 4;
// a nest follows a vortex of its own only within TETHER parent cells of the parent's storm centre
// (its followed updraft; place() searches as far): a low-level spin carried off by the gust front,
// away from any updraft, is not the storm's (SupercellB's 250 m nest followed one 20-25 km from
// the updraft, and the tornado formed there, 2026-11-05)
static double TETHER = 8;

enum { U, V, W, P, TH, QV, QC, QR, QH, QSN, NPROG };
// field kinds (CloudModel.KINDS): 0 cell, 1 u-face, 2 v-face, 3 w-face
static const int KIND[NPROG] = {1, 2, 3, 0, 0, 0, 0, 0, 0, 0};
static const int SCALARS[6] = {TH, QV, QC, QR, QH, QSN};
static const int FEED[9] = {U, V, W, TH, QV, QC, QR, QH, QSN};

typedef struct {
  int on;
  double x, y, ox, oy;
  int hasO, inBox, push;
  double r, z, rz, w, tau, t1, ramp;
} Drive;

typedef struct {
  double *th, *qv, *u, *v; // levels
  double tau, psfc;
  int hasPsfc;
} Env;

typedef struct Model Model;
struct Model {
  int nx, ny, nz, SX, SXY, N;
  double dx, dt, cs, K, Kh, umove, vmove, ztop, zdamp, time, cd, z0, psfc;
  int hail, autoToIce, follow;
  double n0h;
  int ox, oy;
  double *f[NPROG], *fS[NPROG], *R[NPROG]; // 1-based (index 0 unused)
  double *B, *pOld, *rainSfc, *hailSfc, *fastPs, *fastDp, *fastPd;
  // levels, index k from -2 (the pointers are offset into their blocks)
  double *zf, *zc, *dzc, *dzw, *th0, *qv0, *u0, *v0, *pi0, *p0, *rho0, *rhow, *lapTh, *lapQv, *lapU, *lapV;
  int *lo[4], *hi[4];
  double cpRate;
  double cpTop; // the cold pool's top (m): the engine's depth (EngineRun), COLD_TOP until it sends one
  Drive drive, drive2;
  Env *env; // the root owns envStore; nests point at their parent's
  Env envStore;
  double *envTh, *envQv, *envU, *envV;
  int stormI, stormJ; // 0: none yet
  double uhMax;
  // nest
  Model *parent, *child;
  int ratio, steps, feedback, i0, j0;
  double vortex, X0, Y0, bcA;
  int holding; // this nest follows a vortex of its own (recentre), so its parent nest follows it too
  double *pOldP[NPROG]; // the parent's fields at the start of its step
  int nb[4];
  int *bOn[4], *bO[4];
  double *bW[4];
  double feedJump[NPROG];
};

static double *grid(int N) { return calloc(N + 1, sizeof(double)); }
static double *lev(int nz) { return (double *)calloc(nz + 12, sizeof(double)) + 2; }
static inline int clampi(int x, int a, int b) { return x < a ? a : (x > b ? b : x); }
static inline double clampd(double x, double a, double b) { return x < a ? a : (x > b ? b : x); }
static inline double maxd(double a, double b) { return a > b ? a : b; }
static inline double mind(double a, double b) { return a < b ? a : b; }
static inline int idx(const Model *m, int i, int j, int k) { return (i + 2) + (j + 1) * m->SX + (k + 1) * m->SXY; }

static double satMix(double p, double T) { return 380.2 / p * exp(17.27 * (T - 273.15) / (T - 35.86)); }

// ---- creation -----------------------------------------------------------------------------

// A model of nx x ny cells and nz levels; then fill zf (levels 1..nz+1) and call cm_metrics.
// zdamp: NaN for the default (4 km under the lid).
EXPORT(cm_new) Model *cm_new(int nx, int ny, int nz, double dx, double dt, double cs, double K, double Kh, double umove, double vmove, double zdamp, double z0, int follow, int hail, double n0h, int autoToIce) {
  Model *m = calloc(1, sizeof(Model));
  m->nx = nx; m->ny = ny; m->nz = nz; m->dx = dx; m->dt = dt; m->cs = cs; m->K = K; m->Kh = Kh;
  m->umove = umove; m->vmove = vmove; m->zdamp = zdamp; m->z0 = z0; m->follow = follow; m->hail = hail; m->n0h = n0h; m->autoToIce = autoToIce;
  m->cpTop = COLD_TOP;
  m->SX = nx + 4;
  m->SXY = m->SX * (ny + 4);
  m->N = m->SXY * (nz + 5);
  int N = m->N;
  for (int q = 0; q < NPROG; q++) { m->f[q] = grid(N); m->fS[q] = grid(N); m->R[q] = grid(N); }
  m->B = grid(N); m->pOld = grid(N); m->fastPs = grid(N); m->fastDp = grid(N); m->fastPd = grid(N);
  m->rainSfc = grid(m->SXY); m->hailSfc = grid(m->SXY);
  double **L[16] = {&m->zf, &m->zc, &m->dzc, &m->dzw, &m->th0, &m->qv0, &m->u0, &m->v0, &m->pi0, &m->p0, &m->rho0, &m->rhow, &m->lapTh, &m->lapQv, &m->lapU, &m->lapV};
  for (int q = 0; q < 16; q++) *L[q] = lev(nz);
  m->envTh = lev(nz); m->envQv = lev(nz); m->envU = lev(nz); m->envV = lev(nz);
  int nrows = N / m->SX;
  for (int f = 0; f < 4; f++) { m->lo[f] = calloc(nrows, sizeof(int)); m->hi[f] = calloc(nrows, sizeof(int)); }
  return m;
}

// vertical metrics from zf, the lid, the sponge and the drag coefficient
EXPORT(cm_metrics) void cm_metrics(Model *m) {
  int nz = m->nz;
  double *zf = m->zf, *zc = m->zc, *dzc = m->dzc, *dzw = m->dzw;
  for (int k = 1; k <= nz; k++) { zc[k] = 0.5 * (zf[k] + zf[k + 1]); dzc[k] = zf[k + 1] - zf[k]; }
  for (int k = 2; k <= nz; k++) dzw[k] = zc[k] - zc[k - 1];
  dzc[0] = dzc[1]; dzc[-1] = dzc[1];
  dzc[nz + 1] = dzc[nz]; dzc[nz + 2] = dzc[nz]; dzc[nz + 3] = dzc[nz];
  dzw[1] = dzc[1]; dzw[0] = dzc[1]; dzw[-1] = dzc[1];
  dzw[nz + 1] = dzc[nz]; dzw[nz + 2] = dzc[nz]; dzw[nz + 3] = dzc[nz];
  zc[0] = -zc[1]; zc[-1] = -zc[1] - dzc[1];
  zc[nz + 1] = zc[nz] + dzc[nz]; zc[nz + 2] = zc[nz] + 2 * dzc[nz]; zc[nz + 3] = zc[nz] + 3 * dzc[nz];
  m->ztop = zf[nz + 1];
  if (isnan(m->zdamp)) m->zdamp = m->ztop - 4000;
  m->cd = m->z0 > 0 ? pow(0.4 / log(zc[1] / m->z0), 2) : 0;
}

static double *baseLap(Model *m, const double *t, double *out) {
  int nz = m->nz;
  for (int k = 1; k <= nz; k++) {
    double up = k < nz ? (t[k + 1] - t[k]) / m->dzw[k + 1] : 0;
    double dn = k > 1 ? (t[k] - t[k - 1]) / m->dzw[k] : 0;
    out[k] = m->K * (up - dn) / m->dzc[k];
  }
  return out;
}

static void ghost(double *t, int nz) {
  t[0] = t[1]; t[-1] = t[1];
  t[nz + 1] = t[nz]; t[nz + 2] = t[nz]; t[nz + 3] = t[nz];
}

static void hydrostatic(Model *m) {
  int nz = m->nz;
  double *zc = m->zc, *zf = m->zf, *dzc = m->dzc, *dzw = m->dzw;
  double *th0 = m->th0, *qv0 = m->qv0, *pi0 = m->pi0, *p0 = m->p0, *rho0 = m->rho0, *rhow = m->rhow;
  double piPrev = pow(m->psfc / P00, KAPPA), zPrev = 0;
  double thvPrev = th0[1] * (1 + 0.61 * qv0[1]);
  for (int k = 1; k <= nz; k++) {
    double thv = th0[k] * (1 + 0.61 * qv0[k]);
    double pik = piPrev - G / CP * (zc[k] - zPrev) / (0.5 * (thv + thvPrev));
    pi0[k] = pik;
    double pk = P00 * pow(pik, 1 / KAPPA);
    p0[k] = pk;
    rho0[k] = pk / (RD * th0[k] * pik * (1 + 0.61 * qv0[k]));
    piPrev = pik; zPrev = zc[k]; thvPrev = thv;
  }
  double *gs[7] = {th0, qv0, pi0, p0, rho0, m->u0, m->v0};
  for (int q = 0; q < 7; q++) ghost(gs[q], nz);
  for (int k = 2; k <= nz; k++) {
    double f = (zf[k] - zc[k - 1]) / dzw[k];
    rhow[k] = rho0[k - 1] + (rho0[k] - rho0[k - 1]) * f;
  }
  rhow[1] = rho0[1] + (rho0[1] - rho0[2]) * (zc[1] / dzw[2]);
  rhow[nz + 1] = rho0[nz] - (rho0[nz - 1] - rho0[nz]) * (0.5 * dzc[nz] / dzw[nz]);
  baseLap(m, th0, m->lapTh); baseLap(m, qv0, m->lapQv); baseLap(m, m->u0, m->lapU); baseLap(m, m->v0, m->lapV);
}

static void fill(Model *m);

// The base state (th0, qv0, u0, v0 at levels 1..nz, written by the caller) made hydrostatic, and
// the fields set to it: the environment, in the moving frame.
EXPORT(cm_base) void cm_base(Model *m, double psfc) {
  m->psfc = psfc;
  hydrostatic(m);
  int nz = m->nz;
  for (int k = -1; k <= nz + 3; k++) {
    int kk = clampi(k, 1, nz);
    for (int j = -1; j <= m->ny + 2; j++)
      for (int i = -1; i <= m->nx + 2; i++) {
        int n = idx(m, i, j, k);
        m->f[U][n] = m->u0[kk] - m->umove;
        m->f[V][n] = m->v0[kk] - m->vmove;
        m->f[TH][n] = m->th0[kk];
        m->f[QV][n] = m->qv0[kk];
      }
  }
  fill(m);
}

// ---- steering -----------------------------------------------------------------------------

// The engine's newest air (envTh.. written by the caller, levels 1..nz): the base state eases
// toward it from now on (CloudModel.relaxEnvironment). on 0 clears it.
EXPORT(cm_set_env) void cm_set_env(Model *m, int on, double tau, double psfc, int hasPsfc) {
  if (!on) { m->env = NULL; return; }
  Env *e = &m->envStore;
  int nz = m->nz;
  // (a new target replaces the old; a nest keeps pointing at this one)
  if (!e->th) { e->th = lev(nz); e->qv = lev(nz); e->u = lev(nz); e->v = lev(nz); }
  memcpy(e->th - 2, m->envTh - 2, (nz + 12) * sizeof(double));
  memcpy(e->qv - 2, m->envQv - 2, (nz + 12) * sizeof(double));
  memcpy(e->u - 2, m->envU - 2, (nz + 12) * sizeof(double));
  memcpy(e->v - 2, m->envV - 2, (nz + 12) * sizeof(double));
  e->tau = tau; e->psfc = psfc; e->hasPsfc = hasPsfc;
  m->env = e;
}

static void relaxEnvironment(Model *m, double dt) {
  Env *e = m->env;
  double a = mind(1, dt / e->tau);
  int nz = m->nz, SXY = m->SXY;
  double *th0 = m->th0, *qv0 = m->qv0, *u0 = m->u0, *v0 = m->v0;
  double *u = m->f[U], *v = m->f[V], *th = m->f[TH], *qv = m->f[QV];
  for (int k = 1; k <= nz; k++) {
    double dth = a * (e->th[k] - th0[k]), dq = a * (e->qv[k] - qv0[k]);
    double du = a * (e->u[k] - u0[k]), dv = a * (e->v[k] - v0[k]);
    th0[k] += dth; qv0[k] += dq; u0[k] += du; v0[k] += dv;
    int n0 = (k + 1) * SXY + 1;
    for (int n = n0; n <= n0 + SXY - 1; n++) {
      th[n] += dth;
      qv[n] = maxd(0, qv[n] + dq);
      u[n] += du;
      v[n] += dv;
    }
  }
  if (e->hasPsfc) m->psfc += a * (e->psfc - m->psfc);
  hydrostatic(m);
}

EXPORT(cm_set_motion) void cm_set_motion(Model *m, double um, double vm) {
  double du = um - m->umove, dv = vm - m->vmove;
  if (du != 0 || dv != 0) {
    double *u = m->f[U], *v = m->f[V];
    for (int n = 1; n <= m->N; n++) { u[n] -= du; v[n] -= dv; }
    m->umove = um; m->vmove = vm;
  }
  if (m->child) cm_set_motion(m->child, um, vm);
}

EXPORT(cm_cold_pool_rate) double cm_cold_pool_rate(Model *m, double targetK, double tau) {
  double *th = m->f[TH];
  double sum = 0;
  int n = 0;
  for (int j = 1; j <= m->ny; j++)
    for (int i = 1; i <= m->nx; i++) {
      double d = m->th0[1] - th[(i + 2) + (j + 1) * m->SX + 2 * m->SXY];
      if (d > COLD_K) { sum += d; n++; }
    }
  if (n < 4) { m->cpRate = 0; return 0; }
  double mean = sum / n;
  double f = clampd(targetK / mean, 0.25, 2);
  m->cpRate = (f - 1) / tau;
  return mean;
}

static void applyColdPool(Model *m, double dt) {
  double s = 1 + m->cpRate * dt;
  double *th = m->f[TH];
  for (int k = 1; k <= m->nz; k++) {
    if (m->zc[k] > m->cpTop) break;
    double t0 = m->th0[k];
    for (int j = 1; j <= m->ny; j++) {
      int n0 = 2 + (j + 1) * m->SX + (k + 1) * m->SXY;
      for (int i = 1; i <= m->nx; i++) {
        int n = n0 + i;
        double d = th[n] - t0;
        if (d < 0) th[n] = t0 + s * d;
      }
    }
  }
}

// a drive (CloudModel.applyDrive): which = 1 drive, 2 drive2; hasO 0 for no ox, oy. push 0: w is
// eased up toward w (m/s) in the ball over tau; push 1: w is an upward acceleration (m/s^2) at the
// ball's middle, added to the wind (the pressure and buoyancy answer it; nothing is overwritten)
EXPORT(cm_set_drive) void cm_set_drive(Model *m, int which, int on, double x, double y, int hasO, double ox, double oy, int inBox, double r, double z, double rz, double w, double tau, double t1, double ramp, int push) {
  Drive *d = which == 2 ? &m->drive2 : &m->drive;
  d->on = on; d->x = x; d->y = y; d->hasO = hasO; d->ox = ox; d->oy = oy; d->inBox = inBox; d->push = push;
  d->r = r; d->z = z; d->rz = rz; d->w = w; d->tau = tau; d->t1 = t1; d->ramp = ramp;
}

// returns 0 once the drive has ended
static int applyDrive(Model *m, const Drive *d, double dt) {
  if (m->time >= d->t1) return 0;
  double xo = 0, yo = 0;
  Model *root = m;
  while (root->parent) { xo += root->X0; yo += root->Y0; root = root->parent; }
  double fade = d->ramp > 0 ? clampd((d->t1 - m->time) / d->ramp, 0, 1) : 1;
  double a = fade * dt / d->tau;
  double dx = m->dx;
  int SX = m->SX, SXY = m->SXY;
  double *zf = m->zf, *w = m->f[W];
  double dox = d->hasO ? d->ox : 0, doy = d->hasO ? d->oy : 0;
  double xc = (d->inBox ? d->x : d->x - (root->ox - dox) * root->dx) - xo;
  double yc = (d->inBox ? d->y : d->y - (root->oy - doy) * root->dx) - yo;
  int i0 = (int)fmax(1, floor((xc - d->r) / dx)), i1 = (int)fmin(m->nx, ceil((xc + d->r) / dx) + 1);
  int j0 = (int)fmax(1, floor((yc - d->r) / dx)), j1 = (int)fmin(m->ny, ceil((yc + d->r) / dx) + 1);
  for (int k = 2; k <= m->nz; k++) {
    double sz = (zf[k] - d->z) / d->rz;
    if (sz * sz < 1) {
      for (int j = j0; j <= j1; j++) {
        double sy = ((j - 0.5) * dx - yc) / d->r;
        for (int i = i0; i <= i1; i++) {
          double sx = ((i - 0.5) * dx - xc) / d->r;
          double Rr = sqrt(sx * sx + sy * sy + sz * sz);
          if (Rr < 1) {
            double c = cos(0.5 * PI * Rr);
            int n = (i + 2) + (j + 1) * SX + (k + 1) * SXY;
            if (d->push) { w[n] += fade * d->w * (c * c) * dt; continue; }
            double target = d->w * (c * c);
            if (w[n] < target) w[n] += mind(1, a) * (target - w[n]);
          }
        }
      }
    }
  }
  return 1;
}

// ---- boundaries ---------------------------------------------------------------------------

static void fillLateral(double *f, int nx, int ny, int nz, int SX, int SXY, int kind) {
  for (int k = -1; k <= nz + 3; k++) {
    int kb = (k + 1) * SXY;
    for (int j = -1; j <= ny + 2; j++) {
      int b = kb + (j + 1) * SX;
      if (kind == 1) {
        f[b + 3] = f[b + 4];
        f[b + nx + 3] = f[b + nx + 2];
        double t = f[b + 3];
        f[b + 2] = t; f[b + 1] = t;
        f[b + nx + 4] = f[b + nx + 3];
      } else {
        double t = f[b + 3];
        f[b + 2] = t; f[b + 1] = t;
        double s = f[b + nx + 2];
        f[b + nx + 3] = s; f[b + nx + 4] = s;
      }
    }
    int r1 = kb + 2 * SX, r0 = kb + SX, rm = kb;
    int rn = kb + (ny + 1) * SX, rn1 = kb + (ny + 2) * SX, rn2 = kb + (ny + 3) * SX;
    if (kind == 2) {
      int r2 = kb + 3 * SX;
      for (int i = 1; i <= SX; i++) { f[r1 + i] = f[r2 + i]; f[rn1 + i] = f[rn + i]; }
    }
    for (int i = 1; i <= SX; i++) {
      f[r0 + i] = f[r1 + i];
      f[rm + i] = f[r1 + i];
      if (kind == 2) f[rn2 + i] = f[rn1 + i];
      else { f[rn1 + i] = f[rn + i]; f[rn2 + i] = f[rn + i]; }
    }
  }
}

static void fillVertical(double *f, int nz, int SXY, int isW) {
  int z1 = 2 * SXY, z0 = SXY, zm = 0;
  int zn = (nz + 1) * SXY, zn1 = (nz + 2) * SXY, zn2 = (nz + 3) * SXY, zn3 = (nz + 4) * SXY;
  if (isW) {
    int f1 = 2 * SXY, f2 = 3 * SXY, f3 = 4 * SXY;
    int fn = (nz + 1) * SXY, fn1 = (nz + 2) * SXY, fnm1 = nz * SXY;
    for (int i = 1; i <= SXY; i++) {
      f[f1 + i] = 0;
      f[z0 + i] = -f[f2 + i];
      f[zm + i] = -f[f3 + i];
      f[fn1 + i] = 0;
      f[zn2 + i] = -f[fn + i];
      f[zn3 + i] = -f[fnm1 + i];
    }
  } else {
    for (int i = 1; i <= SXY; i++) {
      double a = f[z1 + i];
      f[z0 + i] = a; f[zm + i] = a;
      double b = f[zn + i];
      f[zn1 + i] = b; f[zn2 + i] = b; f[zn3 + i] = b;
    }
  }
}

static void applyBoundary(Model *nest, int q, double *f, int kind);

static void lateral(Model *m, int q) {
  int kind = KIND[q];
  fillLateral(m->f[q], m->nx, m->ny, m->nz, m->SX, m->SXY, kind == 3 ? 0 : kind);
  if (m->parent) applyBoundary(m, q, m->f[q], kind);
}

static void fill(Model *m) {
  for (int q = 0; q < NPROG; q++) lateral(m, q);
  fillVertical(m->f[U], m->nz, m->SXY, 0);
  fillVertical(m->f[V], m->nz, m->SXY, 0);
  fillVertical(m->f[W], m->nz, m->SXY, 1);
  const int rest[7] = {P, TH, QV, QC, QR, QH, QSN};
  for (int q = 0; q < 7; q++) fillVertical(m->f[rest[q]], m->nz, m->SXY, 0);
}

EXPORT(cm_fill) void cm_fill(Model *m) { fill(m); }

// ---- slow tendencies ----------------------------------------------------------------------

static inline double up3(const double *f, int n, int s, double a, double c) {
  if (a >= 0) return a * c * (2 * f[n + s] + 3 * f[n] - 6 * f[n - s] + f[n - 2 * s]);
  return a * c * (-f[n + 2 * s] + 6 * f[n + s] - 3 * f[n] - 2 * f[n - s]);
}

static inline double lapf(const double *f, int n, int sy, int sz, double kh, double kv, double up, double dn) {
  double c = f[n];
  return (f[n + 1] + f[n - 1] + f[n + sy] + f[n - sy] - 4 * c) * kh + ((f[n + sz] - c) / up - (c - f[n - sz]) / dn) * kv;
}

static void rowSpans(const double *f, int SX, int nrows, int *lo, int *hi) {
  for (int r = 0; r < nrows; r++) {
    int b = r * SX, a = SX + 1, z = 0;
    for (int i = 1; i <= SX; i++)
      if (f[b + i] != 0) { a = i; break; }
    if (a <= SX)
      for (int i = SX; i >= a; i--)
        if (f[b + i] != 0) { z = i; break; }
    lo[r] = a;
    hi[r] = z;
  }
}

static void slow(Model *m) {
  int nx = m->nx, ny = m->ny, nz = m->nz, SX = m->SX, SXY = m->SXY;
  double *u = m->f[U], *v = m->f[V], *w = m->f[W], *th = m->f[TH], *qv = m->f[QV];
  double *Ru = m->R[U], *Rv = m->R[V], *Rw = m->R[W], *Rth = m->R[TH], *Rqv = m->R[QV], *B = m->B;
  double cx = 1 / (6 * m->dx), K = m->K, kh = m->Kh / (m->dx * m->dx);
  int sy = SX, sz = SXY;
  double zd = m->zdamp, ztop = m->ztop, um = m->umove, vm = m->vmove;
  double u0g = m->u0[1], v0g = m->v0[1];
  double s0 = sqrt(u0g * u0g + v0g * v0g);
  int SY = SXY / SX, nrows = m->N / SX;
  const double *HF[4] = {m->f[QC], m->f[QR], m->f[QH], m->f[QSN]};
  double *HR[4] = {m->R[QC], m->R[QR], m->R[QH], m->R[QSN]};
  for (int f = 0; f < 4; f++) rowSpans(HF[f], SX, nrows, m->lo[f], m->hi[f]);
  const double *qc = m->f[QC], *qr = m->f[QR], *qh = m->f[QH], *qsn = m->f[QSN];
  for (int k = 1; k <= nz; k++) {
    double t0 = m->th0[k], q0 = m->qv0[k];
    for (int j = 1; j <= ny; j++) {
      int n = 2 + (j + 1) * SX + (k + 1) * SXY;
      for (int i = 1; i <= nx; i++) {
        int c = n + i;
        B[c] = G * ((th[c] - t0) / t0 + 0.61 * (qv[c] - q0) - qc[c] - qr[c] - qh[c] - qsn[c]);
      }
    }
  }
  for (int k = 1; k <= nz; k++) {
    double z = m->zc[k], zfk = m->zf[k];
    double damp = z > zd ? (1 - cos(0.5 * PI * (z - zd) / (ztop - zd))) / 300 : 0;
    double dampW = zfk > zd ? (1 - cos(0.5 * PI * (zfk - zd) / (ztop - zd))) / 300 : 0;
    double ue = m->u0[k] - um, ve = m->v0[k] - vm;
    double czc = 1 / (6 * m->dzc[k]), czw = 1 / (6 * m->dzw[k]);
    double kvc = K / m->dzc[k], kvw = K / m->dzw[k];
    double upC = m->dzw[k + 1], dnC = m->dzw[k];
    double upW = m->dzc[k], dnW = m->dzc[k - 1];
    double cd = k == 1 ? m->cd / m->dzc[1] : 0;
    double bTh = m->lapTh[k], bQv = m->lapQv[k], bU = m->lapU[k], bV = m->lapV[k];
    double th0k = m->th0[k];
    for (int j = 1; j <= ny; j++) {
      int n0 = 2 + (j + 1) * SX + (k + 1) * SXY;
      for (int i = 1; i <= nx; i++) {
        int n = n0 + i;
        double Uc = 0.5 * (u[n] + u[n + 1]);
        double Vc = 0.5 * (v[n] + v[n + sy]);
        double Wc = 0.5 * (w[n] + w[n + sz]);
        Rth[n] = -(up3(th, n, 1, Uc, cx) + up3(th, n, sy, Vc, cx) + up3(th, n, sz, Wc, czc)) + lapf(th, n, sy, sz, kh, kvc, upC, dnC) - bTh - damp * (th[n] - th0k);
        Rqv[n] = -(up3(qv, n, 1, Uc, cx) + up3(qv, n, sy, Vc, cx) + up3(qv, n, sz, Wc, czc)) + lapf(qv, n, sy, sz, kh, kvc, upC, dnC) - bQv;
        {
          double Vu = 0.25 * (v[n] + v[n - 1] + v[n + sy] + v[n - 1 + sy]);
          double Wu = 0.25 * (w[n] + w[n - 1] + w[n + sz] + w[n - 1 + sz]);
          double a = u[n];
          double r = -(up3(u, n, 1, a, cx) + up3(u, n, sy, Vu, cx) + up3(u, n, sz, Wu, czc)) + lapf(u, n, sy, sz, kh, kvc, upC, dnC) - bU - damp * (a - ue);
          if (cd > 0) {
            double ug = a + um, vg = Vu + vm;
            r -= cd * (sqrt(ug * ug + vg * vg) * ug - s0 * u0g);
          }
          Ru[n] = r;
        }
        {
          double Uv = 0.25 * (u[n] + u[n + 1] + u[n - sy] + u[n + 1 - sy]);
          double Wv = 0.25 * (w[n] + w[n - sy] + w[n + sz] + w[n - sy + sz]);
          double a = v[n];
          double r = -(up3(v, n, 1, Uv, cx) + up3(v, n, sy, a, cx) + up3(v, n, sz, Wv, czc)) + lapf(v, n, sy, sz, kh, kvc, upC, dnC) - bV - damp * (a - ve);
          if (cd > 0) {
            double ug = Uv + um, vg = a + vm;
            r -= cd * (sqrt(ug * ug + vg * vg) * vg - s0 * v0g);
          }
          Rv[n] = r;
        }
        if (k >= 2) {
          double Uw = 0.25 * (u[n] + u[n + 1] + u[n - sz] + u[n + 1 - sz]);
          double Vw = 0.25 * (v[n] + v[n + sy] + v[n - sz] + v[n + sy - sz]);
          double a = w[n];
          Rw[n] = -(up3(w, n, 1, Uw, cx) + up3(w, n, sy, Vw, cx) + up3(w, n, sz, a, czw)) + lapf(w, n, sy, sz, kh, kvw, upW, dnW) + 0.5 * (B[n] + B[n - sz]) - dampW * a;
        } else {
          Rw[n] = 0;
        }
      }
    }
    for (int f = 0; f < 4; f++) {
      const int *lo = m->lo[f], *hi = m->hi[f];
      const double *F = HF[f];
      double *R = HR[f];
      for (int j = 1; j <= ny; j++) {
        int r = (j + 1) + (k + 1) * SY;
        int a = lo[r] - 2, z = hi[r] + 2;
        for (int d = 1; d <= 2; d++) {
          int rr[4] = {r - d, r + d, r - d * SY, r + d * SY};
          for (int q = 0; q < 4; q++) {
            if (lo[rr[q]] < a) a = lo[rr[q]];
            if (hi[rr[q]] > z) z = hi[rr[q]];
          }
        }
        int i1 = a - 2 > 1 ? a - 2 : 1, i2 = z - 2 < nx ? z - 2 : nx;
        int n0 = 2 + (j + 1) * SX + (k + 1) * SXY;
        if (i1 > i2) {
          for (int i = 1; i <= nx; i++) R[n0 + i] = 0;
        } else {
          for (int i = 1; i < i1; i++) R[n0 + i] = 0;
          for (int i = i2 + 1; i <= nx; i++) R[n0 + i] = 0;
          for (int i = i1; i <= i2; i++) {
            int n = n0 + i;
            double Uc = 0.5 * (u[n] + u[n + 1]);
            double Vc = 0.5 * (v[n] + v[n + sy]);
            double Wc = 0.5 * (w[n] + w[n + sz]);
            R[n] = -(up3(F, n, 1, Uc, cx) + up3(F, n, sy, Vc, cx) + up3(F, n, sz, Wc, czc)) + lapf(F, n, sy, sz, kh, kvc, upC, dnC);
          }
        }
      }
    }
  }
}

// ---- acoustic substeps --------------------------------------------------------------------

static void fast(Model *m, double dts) {
  int nx = m->nx, ny = m->ny, nz = m->nz, SX = m->SX, SXY = m->SXY, N = m->N;
  double *u = m->f[U], *v = m->f[V], *w = m->f[W], *p = m->f[P], *pOld = m->pOld;
  double *Ru = m->R[U], *Rv = m->R[V], *Rw = m->R[W];
  double *rho0 = m->rho0, *rhow = m->rhow, *dzc = m->dzc, *dzw = m->dzw;
  double dx = m->dx, cs2 = m->cs * m->cs;
  int ns = (int)fmax(1, ceil(dts / (0.5 * dx / m->cs)));
  double tau = dts / ns;
  int sy = SX, sz = SXY;
  double beta = 0.1;
  size_t bytes = (size_t)(N + 1) * sizeof(double);
  memcpy(u, m->fS[U], bytes);
  memcpy(v, m->fS[V], bytes);
  memcpy(w, m->fS[W], bytes);
  memcpy(p, m->fS[P], bytes);
  memcpy(pOld, m->fS[P], bytes);
  double idxd = 1 / dx, b = tau * cs2;
  double lo[64 + 8], di[64 + 8], hi[64 + 8], cpf[64 + 8], den[64 + 8];
  double *LO = nz + 2 <= 72 ? lo : malloc((nz + 2) * sizeof(double));
  double *DI = nz + 2 <= 72 ? di : malloc((nz + 2) * sizeof(double));
  double *HI = nz + 2 <= 72 ? hi : malloc((nz + 2) * sizeof(double));
  double *CP_ = nz + 2 <= 72 ? cpf : malloc((nz + 2) * sizeof(double));
  double *DEN = nz + 2 <= 72 ? den : malloc((nz + 2) * sizeof(double));
  for (int k = 2; k <= nz; k++) {
    double a = tau / (rhow[k] * dzw[k]);
    LO[k] = k > 2 ? -a * b * rhow[k - 1] / dzc[k - 1] : 0;
    HI[k] = k < nz ? -a * b * rhow[k + 1] / dzc[k] : 0;
    DI[k] = 1 + a * b * rhow[k] * (1 / dzc[k] + 1 / dzc[k - 1]);
  }
  for (int k = 2; k <= nz; k++) {
    double d = DI[k] - (k > 2 ? LO[k] * CP_[k - 1] : 0);
    DEN[k] = d;
    CP_[k] = HI[k] / d;
  }
  double *ps = m->fastPs, *dp = m->fastDp, *pd = m->fastPd;
  memcpy(pd, m->fS[P], bytes);
  for (int s = 1; s <= ns; s++) {
    for (int k = 1; k <= nz; k++) {
      double cu = tau * idxd / rho0[k];
      for (int j = 1; j <= ny; j++) {
        int n0 = 2 + (j + 1) * SX + (k + 1) * SXY;
        for (int i = 1; i <= nx; i++) {
          int n = n0 + i;
          double pn = pd[n];
          if (i >= 2) u[n] += tau * Ru[n] - cu * (pn - pd[n - 1]);
          if (j >= 2) v[n] += tau * Rv[n] - cu * (pn - pd[n - sy]);
        }
      }
    }
    lateral(m, U);
    lateral(m, V);
    for (int k = 1; k <= nz; k++) {
      double br = b * rho0[k];
      for (int j = 1; j <= ny; j++) {
        int n0 = 2 + (j + 1) * SX + (k + 1) * SXY;
        for (int i = 1; i <= nx; i++) {
          int n = n0 + i;
          pOld[n] = p[n];
          ps[n] = p[n] - br * ((u[n + 1] - u[n]) * idxd + (v[n + sy] - v[n]) * idxd);
        }
      }
    }
    for (int k = 2; k <= nz; k++) {
      double a = tau / (rhow[k] * dzw[k]);
      double lk = LO[k], dk = DEN[k];
      for (int j = 1; j <= ny; j++) {
        int n0 = 2 + (j + 1) * SX + (k + 1) * SXY;
        for (int i = 1; i <= nx; i++) {
          int n = n0 + i;
          double rhs = w[n] + tau * Rw[n] - a * (ps[n] - ps[n - sz]);
          dp[n] = (rhs - (k > 2 ? lk * dp[n - sz] : 0)) / dk;
        }
      }
    }
    for (int k = nz; k >= 2; k--) {
      double ck = CP_[k];
      for (int j = 1; j <= ny; j++) {
        int n0 = 2 + (j + 1) * SX + (k + 1) * SXY;
        for (int i = 1; i <= nx; i++) {
          int n = n0 + i;
          w[n] = dp[n] - (k < nz ? ck * w[n + sz] : 0);
        }
      }
    }
    for (int k = 1; k <= nz; k++) {
      double rb = rhow[k], rt = rhow[k + 1], dzk = dzc[k];
      for (int j = 1; j <= ny; j++) {
        int n0 = 2 + (j + 1) * SX + (k + 1) * SXY;
        for (int i = 1; i <= nx; i++) {
          int n = n0 + i;
          double wb = k >= 2 ? w[n] : 0;
          double wt = k < nz ? w[n + sz] : 0;
          double pn = ps[n] - b * (rt * wt - rb * wb) / dzk;
          p[n] = pn;
          pd[n] = pn + beta * (pn - pOld[n]);
        }
      }
    }
    fillVertical(w, nz, SXY, 1);
  }
  if (LO != lo) { free(LO); free(DI); free(HI); free(CP_); free(DEN); }
}

// ---- microphysics -------------------------------------------------------------------------

static void micro(Model *m, double dt) {
  int nx = m->nx, ny = m->ny, nz = m->nz, SX = m->SX, SXY = m->SXY;
  double *th = m->f[TH], *qv = m->f[QV], *qc = m->f[QC], *qr = m->f[QR], *qh = m->f[QH], *p = m->f[P], *qsn = m->f[QSN];
  int hail = m->hail;
  double N0H = m->n0h;
  double *vh = calloc(nz + 2, sizeof(double)), *vs = calloc(nz + 2, sizeof(double)), *vt = calloc(nz + 2, sizeof(double));
  double *hailS = m->hailSfc, *rain = m->rainSfc;
  double *p0 = m->p0, *rho0 = m->rho0, *dzc = m->dzc;
  double rhoS = rho0[1];
  for (int j = 1; j <= ny; j++) {
    for (int i = 1; i <= nx; i++) {
      int col = 2 + (j + 1) * SX + i;
      int sub = 1;
      for (int k = 1; k <= nz; k++) {
        int n = col + (k + 1) * SXY;
        double rq = maxd(0, qr[n]);
        double v1 = rq > 1e-9 ? 36.34 * pow(rho0[k] * 1e-3 * rq, 0.1364) * sqrt(rhoS / rho0[k]) : 0;
        vt[k] = v1;
        double hq = maxd(0, qh[n]);
        double v2 = 0;
        if (hail && hq > 1e-9) {
          double lam = pow(PI * RHOH * N0H / (rho0[k] * hq), 0.25);
          v2 = 1.938 * sqrt(4 * G * RHOH / (1.8 * rho0[k])) / sqrt(lam);
        }
        vh[k] = v2;
        double sq = maxd(0, qsn[n]);
        double v3 = 0;
        if (hail && sq > 1e-9) {
          double lams = pow(PI * RHOS * N0S / (rho0[k] * sq), 0.25);
          v3 = SC * G4SD / 6 * pow(lams, -SD) * sqrt(rhoS / rho0[k]);
        }
        vs[k] = v3;
        double cfl = maxd(v1, v2) * dt / dzc[k];
        if (cfl > 0.8) {
          int c = (int)ceil(cfl / 0.8);
          if (c > sub) sub = c;
        }
      }
      double h = dt / sub;
      for (int s = 1; s <= sub; s++) {
        double fluxAbove = 0, fluxH = 0, fluxS = 0;
        for (int k = nz; k >= 1; k--) {
          int n = col + (k + 1) * SXY;
          double F = rho0[k] * vt[k] * maxd(0, qr[n]);
          qr[n] += h * (fluxAbove - F) / (rho0[k] * dzc[k]);
          fluxAbove = F;
          if (hail) {
            double FH = rho0[k] * vh[k] * maxd(0, qh[n]);
            qh[n] += h * (fluxH - FH) / (rho0[k] * dzc[k]);
            fluxH = FH;
            double FS = rho0[k] * vs[k] * maxd(0, qsn[n]);
            qsn[n] += h * (fluxS - FS) / (rho0[k] * dzc[k]);
            fluxS = FS;
          }
        }
      }
      int cs = (j + 1) * SX + i + 2;
      double hs = 3600 * rho0[1] * vh[1] * maxd(0, qh[col + 2 * SXY]);
      hailS[cs] = hs;
      rain[cs] = 3600 * rho0[1] * (vt[1] * maxd(0, qr[col + 2 * SXY]) + vs[1] * maxd(0, qsn[col + 2 * SXY])) + hs;
      for (int k = 1; k <= nz; k++) {
        int n = col + (k + 1) * SXY;
        double pk = p0[k] + p[n];
        double PIk = pow(pk / P00, KAPPA);
        double T = th[n] * PIk;
        double qs = satMix(pk, T);
        double c = maxd(0, qc[n]), r = maxd(0, qr[n]), q = maxd(0, qv[n]), g = maxd(0, qh[n]);
        double sn = maxd(0, qsn[n]);
        double rho = rho0[k];
        double Tc = T - 273.15;
        double ar = maxd(0, 1e-3 * (c - 1e-3)) * dt;
        double cr = 2.2 * c * pow(r, 0.875) * dt;
        double take = mind(c, ar + cr);
        double toIce = (hail && Tc < 0 && m->autoToIce) ? mind(ar, take) : 0;
        c -= take;
        r += take - toIce;
        g += toIce;
        double frozen = toIce;
        if (hail) {
          if (Tc < 0 && c > 0) {
            double x = Tc / HOMO_C;
            double gl = Tc <= HOMO_C ? c : c * (1 - exp(-dt / GLAC_S * (x * x)));
            c -= gl;
            sn += gl;
            frozen += gl;
          }
          if (sn > 1e-9 || (Tc < 0 && c > 1e-6)) {
            double lams = pow(PI * RHOS * N0S / (rho * maxd(sn, 1e-9)), 0.25);
            double csn = SC * sqrt(rhoS / rho);
            double ventS = 0.78 * pow(lams, -2) + 0.31 * 0.843 * G5SD2 * sqrt(csn / NU) * pow(lams, -((5 + SD) / 2));
            if (Tc < 0) {
              double esi = 611.2 * exp(21.87 * Tc / (Tc + 265.5));
              double qsi = 0.622 * esi / (pk - esi);
              double Ap = LS * LS / (KA * RV * T * T);
              double Bp = 1 / (rho * qsi * DV);
              double dep = 2 * PI * (q / qsi - 1) * N0S / (rho * (Ap + Bp)) * ventS * dt;
              if (sn <= 1e-9) dep = 0;
              if (dep > 0) dep = mind(dep, maxd(0, q - qsi));
              else dep = maxd(dep, -sn);
              q -= dep;
              sn += dep;
              th[n] += LS / (CP * PIk) * dep;
              T = th[n] * PIk;
              qs = satMix(pk, T);
              if (sn > 1e-9 && c > 0) {
                double rim = mind(c, 0.25 * PI * N0S * c * csn * G3SD * pow(lams, -(3 + SD)) * dt);
                c -= rim;
                sn += rim;
                frozen += rim;
              }
              double gaut = maxd(0, 1e-3 * exp(0.09 * Tc) * (sn - 6e-4)) * dt;
              gaut = mind(gaut, sn);
              sn -= gaut;
              g += gaut;
            } else if (sn > 1e-9) {
              double qs0 = satMix(pk, 273.15);
              double drive = KA * Tc - LV * DV * rho * (qs0 - q);
              if (drive > 0) {
                double mlt = mind(sn, 2 * PI * N0S / (rho * LF) * drive * ventS * dt);
                sn -= mlt;
                r += mlt;
                frozen -= mlt;
              }
            }
          }
          if (g > 1e-9) {
            double lam = pow(PI * RHOH * N0H / (rho * g), 0.25);
            double A = sqrt(4 * G * RHOH / (1.8 * rho));
            double coll = mind(1, 0.25 * PI * N0H * 3.323 * A * pow(lam, -3.5) * dt);
            double gw = c * coll;
            c -= gw;
            if (Tc < 0) {
              double gr = r * coll;
              r -= gr;
              g += gw + gr;
              frozen += gw + gr;
            } else {
              r += gw;
              double qs0 = satMix(pk, 273.15);
              double drive = KA * Tc - LV * DV * rho * (qs0 - q);
              if (drive > 0) {
                double vent = 0.78 * pow(lam, -2) + 0.31 * 0.843 * 1.608 * sqrt(A / NU) * pow(lam, -2.75);
                double mlt = mind(g, 2 * PI * N0H / (rho * LF) * drive * vent * dt);
                g -= mlt;
                r += mlt;
                frozen -= mlt;
              }
            }
          }
          if (Tc < 0 && r > 1e-9) {
            double lamr = pow(PI * 1000 * N0R / (rho * r), 0.25);
            double fr = mind(r, 20 * PI * PI * 100 * N0R * (1000 / rho) * (exp(0.66 * mind(-Tc, 40)) - 1) * pow(lamr, -7) * dt);
            r -= fr;
            g += fr;
            frozen += fr;
          }
          if (frozen != 0) {
            th[n] += LF / (CP * PIk) * frozen;
            T = th[n] * PIk;
            qs = satMix(pk, T);
          }
        }
        if (r > 0 && q < qs) {
          double rr = rho0[k] * 1e-3 * r;
          double C = 1.6 + 124.9 * pow(rr, 0.2046);
          double er = dt * (1 - q / qs) * C * pow(rr, 0.525) / (rho0[k] * 1e-3) / (5.4e5 + 2.55e6 / (pk / 100 * qs));
          er = mind(mind(er, r), maxd(0, qs - q));
          r -= er;
          q += er;
          th[n] -= LV / (CP * PIk) * er;
          T = th[n] * PIk;
          qs = satMix(pk, T);
        }
        double d = (q - qs) / (1 + LV * LV * qs / (CP * RV * T * T));
        if (d < 0) d = maxd(d, -c);
        q -= d;
        c += d;
        th[n] += LV / (CP * PIk) * d;
        qv[n] = q; qc[n] = c; qr[n] = r; qh[n] = g; qsn[n] = sn;
      }
    }
  }
  free(vh); free(vs); free(vt);
}

// ---- the step -----------------------------------------------------------------------------

static void followStorm(Model *m);

static void step(Model *m) {
  double dt = m->dt;
  int N = m->N;
  size_t bytes = (size_t)(N + 1) * sizeof(double);
  for (int q = 0; q < NPROG; q++) memcpy(m->fS[q], m->f[q], bytes);
  int nx = m->nx, ny = m->ny, nz = m->nz, SX = m->SX, SXY = m->SXY;
  const double fracs[3] = {1.0 / 3, 1.0 / 2, 1};
  for (int st = 0; st < 3; st++) {
    double dts = dt * fracs[st];
    slow(m);
    fast(m, dts);
    for (int q = 0; q < 6; q++) {
      int fq = SCALARS[q];
      double *s = m->f[fq], *s0 = m->fS[fq], *R = m->R[fq];
      for (int k = 1; k <= nz; k++)
        for (int j = 1; j <= ny; j++) {
          int n0 = 2 + (j + 1) * SX + (k + 1) * SXY;
          for (int i = 1; i <= nx; i++) {
            int n = n0 + i;
            s[n] = s0[n] + dts * R[n];
          }
        }
    }
    fill(m);
  }
  if (m->env) relaxEnvironment(m, dt);
  if (m->cpRate != 0) applyColdPool(m, dt);
  if (m->drive.on) m->drive.on = applyDrive(m, &m->drive, dt);
  if (m->drive2.on) m->drive2.on = applyDrive(m, &m->drive2, dt);
  micro(m, dt);
  fill(m);
  m->time += dt;
  if (m->follow) followStorm(m);
}

EXPORT(cm_step) void cm_step(Model *m) { step(m); }

// ---- storm following ----------------------------------------------------------------------

static void shift(Model *m, int di, int dj) {
  int nx = m->nx, ny = m->ny, nz = m->nz;
  for (int q = 0; q < NPROG; q++) {
    double *f = m->f[q];
    int i0 = 1, i1 = nx + 1, ist = 1;
    if (di < 0) { i0 = nx + 1; i1 = 1; ist = -1; }
    int j0 = 1, j1 = ny + 1, jst = 1;
    if (dj < 0) { j0 = ny + 1; j1 = 1; jst = -1; }
    for (int k = -1; k <= nz + 3; k++)
      for (int j = j0; jst > 0 ? j <= j1 : j >= j1; j += jst) {
        int jj = clampi(j + dj, 1, ny + 1);
        for (int i = i0; ist > 0 ? i <= i1 : i >= i1; i += ist) {
          int ii = clampi(i + di, 1, nx + 1);
          f[idx(m, i, j, k)] = f[idx(m, ii, jj, k)];
        }
      }
  }
  m->ox += di;
  m->oy += dj;
  fill(m);
}

static inline double zeta(const Model *m, int i, int j, int k) {
  int n = idx(m, i, j, k);
  const double *u = m->f[U], *v = m->f[V];
  return (v[n] - v[n - 1]) / m->dx - (u[n] - u[n - m->SX]) / m->dx;
}

EXPORT(cm_zeta) double cm_zeta(Model *m, int i, int j, int k) { return zeta(m, i, j, k); }

EXPORT(cm_level_at) int cm_level_at(Model *m, double z) {
  double best = INFINITY;
  int bk = 1;
  for (int k = 1; k <= m->nz; k++) {
    double d = fabs(m->zc[k] - z);
    if (d < best) { best = d; bk = k; }
  }
  return bk;
}

static double uh(const Model *m, int i, int j) {
  double s = 0;
  for (int k = 1; k <= m->nz; k++) {
    double z = m->zc[k];
    if (z >= 2000 && z <= 5000) {
      int n = idx(m, i, j, k);
      double w = 0.5 * (m->f[W][n] + m->f[W][n + m->SXY]);
      if (w > 0) {
        double zt = 0.25 * (zeta(m, i, j, k) + zeta(m, i + 1, j, k) + zeta(m, i, j + 1, k) + zeta(m, i + 1, j + 1, k));
        s += w * zt * m->dzc[k];
      }
    }
  }
  return s;
}

static void followStorm(Model *m) {
  int nx = m->nx, ny = m->ny;
  int ti = (int)floor(0.5 * nx), tj = (int)floor(0.45 * ny);
  int R = 12;
  int ja = tj - R - 1 > 2 ? tj - R - 1 : 2, jb = tj + R + 1 < ny - 1 ? tj + R + 1 : ny - 1;
  int ia = ti - R - 1 > 2 ? ti - R - 1 : 2, ib = ti + R + 1 < nx - 1 ? ti + R + 1 : nx - 1;
  int W_ = ib - ia + 1;
  double *raw = calloc((size_t)(W_ > 0 ? W_ : 1) * (jb - ja + 1 > 0 ? jb - ja + 1 : 1), sizeof(double));
  for (int j = ja; j <= jb; j++)
    for (int i = ia; i <= ib; i++) raw[(i - ia) + (j - ja) * W_] = uh(m, i, j);
  double best = 50;
  int bi = 0, bj = 0;
  int j0 = tj - R > 3 ? tj - R : 3, j1 = tj + R < ny - 2 ? tj + R : ny - 2;
  int i0 = ti - R > 3 ? ti - R : 3, i1 = ti + R < nx - 2 ? ti + R : nx - 2;
  for (int j = j0; j <= j1; j++)
    for (int i = i0; i <= i1; i++) {
      double s = 0;
      for (int dj = -1; dj <= 1; dj++)
        for (int d = -1; d <= 1; d++) {
          int ii = i + d, jj = j + dj;
          if (ii >= ia && ii <= ib && jj >= ja && jj <= jb) s += raw[(ii - ia) + (jj - ja) * W_];
        }
      s /= 9;
      if (s > best) { best = s; bi = i; bj = j; }
    }
  free(raw);
  m->uhMax = best;
  if (bi == 0) {
    int k = cm_level_at(m, FOLLOW_Z);
    int SX = m->SX, SXY = m->SXY;
    double *w = m->f[W];
    double bestW = FOLLOW_W;
    for (int j = j0; j <= j1; j++)
      for (int i = i0; i <= i1; i++) {
        double s = 0;
        for (int dj = -1; dj <= 1; dj++)
          for (int d = -1; d <= 1; d++) s += w[(i + d + 2) + (j + dj + 1) * SX + (k + 1) * SXY];
        s /= 9;
        if (s > bestW) { bestW = s; bi = i; bj = j; }
      }
    if (bi == 0) return;
  }
  m->stormI = bi;
  m->stormJ = bj;
  int di = bi > ti + 1 ? 1 : (bi < ti - 1 ? -1 : 0);
  int dj = bj > tj + 1 ? 1 : (bj < tj - 1 ? -1 : 0);
  if (di != 0 || dj != 0) shift(m, di, dj);
}

EXPORT(cm_follow_storm) void cm_follow_storm(Model *m) { followStorm(m); }

// ---- nests (Nest.luau) --------------------------------------------------------------------

// parent stencil of nest point (i, j): the offset of its south-west parent point, and 4 weights
static int stencil(const Model *nest, const Model *parent, int kind, int i, int j, double *wts) {
  double dxn = nest->dx;
  double x = nest->X0 + (i - (kind == 1 ? 1 : 0.5)) * dxn;
  double y = nest->Y0 + (j - (kind == 2 ? 1 : 0.5)) * dxn;
  double fi = x / parent->dx + (kind == 1 ? 1 : 0.5);
  double fj = y / parent->dx + (kind == 2 ? 1 : 0.5);
  fi = clampd(fi, -1, parent->nx + 1.999);
  fj = clampd(fj, -1, parent->ny + 1.999);
  double fi0 = floor(fi), fj0 = floor(fj);
  double a = fi - fi0, b = fj - fj0;
  int o = ((int)fi0 + 2) + ((int)fj0 + 1) * parent->SX;
  wts[0] = (1 - a) * (1 - b); wts[1] = a * (1 - b); wts[2] = (1 - a) * b; wts[3] = a * b;
  return o;
}

static void buildBoundary(Model *nest, const Model *parent) {
  int nx = nest->nx, ny = nest->ny, SXn = nest->SX;
  int cap = (nx + 4) * (ny + 4);
  for (int kind = 0; kind <= 3; kind++) {
    if (!nest->bOn[kind]) {
      nest->bOn[kind] = malloc(cap * sizeof(int));
      nest->bO[kind] = malloc(cap * sizeof(int));
      nest->bW[kind] = malloc(cap * 4 * sizeof(double));
    }
    int c = 0, hk = kind == 3 ? 0 : kind;
    for (int j = -1; j <= ny + 2; j++)
      for (int i = -1; i <= nx + 2; i++) {
        int edgeX = i <= 0 || i >= nx + 1 || (hk == 1 && i == 1);
        int edgeY = j <= 0 || j >= ny + 1 || (hk == 2 && j == 1);
        if (edgeX || edgeY) {
          nest->bO[kind][c] = stencil(nest, parent, hk, i, j, nest->bW[kind] + 4 * c);
          nest->bOn[kind][c] = (i + 2) + (j + 1) * SXn;
          c++;
        }
      }
    nest->nb[kind] = c;
  }
}

static void sampleRegion(Model *nest, const Model *parent, int i1, int i2, int j1, int j2) {
  int nz = nest->nz, SXn = nest->SX, SXYn = nest->SXY, SXYp = parent->SXY, SXp = parent->SX;
  double wts[4];
  for (int q = 0; q < NPROG; q++) {
    int kind = KIND[q], hk = kind == 3 ? 0 : kind;
    double *fn = nest->f[q];
    const double *fp = parent->f[q];
    for (int j = j1; j <= j2; j++)
      for (int i = i1; i <= i2; i++) {
        int o = stencil(nest, parent, hk, i, j, wts);
        int on = (i + 2) + (j + 1) * SXn;
        for (int k = -1; k <= nz + 3; k++) {
          int po = (k + 1) * SXYp;
          fn[on + (k + 1) * SXYn] = wts[0] * fp[o + po] + wts[1] * fp[o + 1 + po] + wts[2] * fp[o + SXp + po] + wts[3] * fp[o + SXp + 1 + po];
        }
      }
  }
}

static void applyBoundary(Model *nest, int q, double *f, int kind) {
  const Model *parent = nest->parent;
  const double *nw = parent->f[q], *old = nest->pOldP[q];
  double a = nest->bcA, b = 1 - a;
  int nz = nest->nz, SXYn = nest->SXY, SXYp = parent->SXY, SXp = parent->SX;
  int k1 = kind == 3 ? nz + 1 : nz;
  int cnt = nest->nb[kind];
  const int *bOn = nest->bOn[kind], *bO = nest->bO[kind];
  const double *bW = nest->bW[kind];
  for (int e = 0; e < cnt; e++) {
    int on = bOn[e], p1 = bO[e], p2 = p1 + 1, p3 = p1 + SXp, p4 = p1 + SXp + 1;
    double w1 = bW[4 * e], w2 = bW[4 * e + 1], w3 = bW[4 * e + 2], w4 = bW[4 * e + 3];
    for (int k = 1; k <= k1; k++) {
      int po = (k + 1) * SXYp;
      double vn = w1 * nw[p1 + po] + w2 * nw[p2 + po] + w3 * nw[p3 + po] + w4 * nw[p4 + po];
      double vo = w1 * old[p1 + po] + w2 * old[p2 + po] + w3 * old[p3 + po] + w4 * old[p4 + po];
      f[on + (k + 1) * SXYn] = b * vo + a * vn;
    }
  }
}

// a nest of nx x ny cells at `ratio`, `steps` steps per parent step, its south-west corner at
// parent cell (i0, j0) (Nest.new)
EXPORT(cm_nest_new) Model *cm_nest_new(Model *parent, int nx, int ny, int ratio, int steps, int i0, int j0, double vortex) {
  int nz = parent->nz;
  Model *nest = cm_new(nx, ny, nz, parent->dx / ratio, parent->dt / steps, parent->cs, parent->K, parent->Kh / ratio, parent->umove, parent->vmove, parent->zdamp, parent->z0, 0, parent->hail, parent->n0h, 0);
  memcpy(nest->zf - 2, parent->zf - 2, (nz + 12) * sizeof(double));
  cm_metrics(nest);
  nest->ratio = ratio;
  nest->steps = steps;
  nest->feedback = 1;
  nest->vortex = vortex;
  nest->i0 = i0; nest->j0 = j0;
  nest->X0 = (i0 - 1) * parent->dx; nest->Y0 = (j0 - 1) * parent->dx;
  nest->parent = parent;
  parent->child = nest;
  nest->time = parent->time;
  nest->psfc = parent->psfc;
  memcpy(nest->th0 - 2, parent->th0 - 2, (nz + 12) * sizeof(double));
  memcpy(nest->qv0 - 2, parent->qv0 - 2, (nz + 12) * sizeof(double));
  memcpy(nest->u0 - 2, parent->u0 - 2, (nz + 12) * sizeof(double));
  memcpy(nest->v0 - 2, parent->v0 - 2, (nz + 12) * sizeof(double));
  hydrostatic(nest);
  buildBoundary(nest, parent);
  sampleRegion(nest, parent, -1, nx + 2, -1, ny + 2);
  size_t pb = (size_t)(parent->N + 1) * sizeof(double);
  for (int q = 0; q < NPROG; q++) {
    nest->pOldP[q] = malloc(pb);
    memcpy(nest->pOldP[q], parent->f[q], pb);
  }
  nest->bcA = 1;
  fill(nest);
  return nest;
}

static void shiftBy(Model *m, int di, int dj, int cells);

// The parent's grid moved under a nest (its fields shifted di, dj cells cells times): the nest
// stays where it is over the ground - only its corner changes, its fields are kept - and follows
// its own vortex by recentring. (Moving with the parent lost the 62.5 m nest's tornado whenever
// the box jumped to a new updraft cell, 2026-11-05.) Where staying would take it off the parent's
// grid it moves with the parent as before.
static void keepPlace(Model *parent, Model *nest, int di, int dj, int cells) {
  int r = nest->ratio;
  int i0 = nest->i0 - di * cells, j0 = nest->j0 - dj * cells;
  if (i0 < 3 || i0 + (double)nest->nx / r > parent->nx - 2 || j0 < 3 || j0 + (double)nest->ny / r > parent->ny - 2) {
    shiftBy(nest, di, dj, cells * r);
    return;
  }
  nest->i0 = i0; nest->j0 = j0;
  nest->X0 = (i0 - 1) * parent->dx; nest->Y0 = (j0 - 1) * parent->dx;
  buildBoundary(nest, parent);
}

static void shiftBy(Model *m, int di, int dj, int cells) {
  for (int c = 0; c < cells; c++) shift(m, di, dj);
  Model *parent = m->parent;
  if (parent) {
    int nx = m->nx, ny = m->ny, r = cells;
    if (di > 0) sampleRegion(m, parent, nx - r, nx + 2, -1, ny + 2);
    else if (di < 0) sampleRegion(m, parent, -1, r + 1, -1, ny + 2);
    if (dj > 0) sampleRegion(m, parent, -1, nx + 2, ny - r, ny + 2);
    else if (dj < 0) sampleRegion(m, parent, -1, nx + 2, -1, r + 1);
    fill(m);
  }
  if (m->child) keepPlace(m, m->child, di, dj, cells);
}

static void feed(Model *parent, Model *nest) {
  int r = nest->ratio;
  double inv = 1.0 / r, inv2 = inv * inv;
  int mg = (int)FEED_MARGIN;
  int npx = nest->nx / r, npy = nest->ny / r;
  int SXn = nest->SX, SXYn = nest->SXY, SXp = parent->SX, SXYp = parent->SXY;
  int nz = parent->nz;
  for (int fq = 0; fq < 9; fq++) {
    int q = FEED[fq], kind = KIND[q];
    double *fp = parent->f[q];
    const double *fn = nest->f[q];
    double jmax = 0;
    int k0 = kind == 3 ? 2 : 1;
    for (int k = k0; k <= nz; k++) {
      int kn = (k + 1) * SXYn, kp = (k + 1) * SXYp;
      for (int J = mg + 1; J <= npy - mg; J++) {
        int j1 = (J - 1) * r + 1;
        int Jp = nest->j0 + J - 1;
        for (int I = mg + 1; I <= npx - mg; I++) {
          int i1 = (I - 1) * r + 1;
          int Ip = nest->i0 + I - 1;
          double sum = 0;
          if (kind == 1) {
            for (int j = j1; j <= j1 + r - 1; j++) sum += fn[(i1 + 2) + (j + 1) * SXn + kn];
            sum *= inv;
          } else if (kind == 2) {
            for (int i = i1; i <= i1 + r - 1; i++) sum += fn[(i + 2) + (j1 + 1) * SXn + kn];
            sum *= inv;
          } else {
            for (int j = j1; j <= j1 + r - 1; j++) {
              int o = (j + 1) * SXn + kn + 2;
              for (int i = i1; i <= i1 + r - 1; i++) sum += fn[o + i];
            }
            sum *= inv2;
          }
          int at = (Ip + 2) + (Jp + 1) * SXp + kp;
          double d = fabs(sum - fp[at]);
          if (d > jmax) jmax = d;
          fp[at] = sum;
        }
      }
    }
    parent->feedJump[q] = jmax;
  }
  fill(parent);
}

static double zetaSmooth(const Model *m, int i, int j, int k) {
  double s = 0;
  for (int dj = -1; dj <= 1; dj++)
    for (int di = -1; di <= 1; di++) s += zeta(m, i + di, j + dj, k);
  return s / 9;
}

// where a nest of nxn cells at `ratio` goes (Nest.place); the corner comes back in *i0, *j0
static void place(const Model *parent, int nxn, int ratio, int *pi0, int *pj0) {
  int k = cm_level_at((Model *)parent, 250);
  int ci = parent->stormI ? parent->stormI : parent->nx / 2;
  int cj = parent->stormI ? parent->stormJ : parent->ny / 2;
  double best = -1;
  int bi = ci, bj = cj;
  int rr = parent->stormI ? 8 : (parent->nx > parent->ny ? parent->nx : parent->ny);
  int ja = cj - rr > 3 ? cj - rr : 3, jb = cj + rr < parent->ny - 2 ? cj + rr : parent->ny - 2;
  int ia = ci - rr > 3 ? ci - rr : 3, ib = ci + rr < parent->nx - 2 ? ci + rr : parent->nx - 2;
  for (int j = ja; j <= jb; j++)
    for (int i = ia; i <= ib; i++) {
      double z = zetaSmooth(parent, i, j, k);
      if (z > best) { best = z; bi = i; bj = j; }
    }
  double half = (double)nxn / ratio / 2;
  *pi0 = (int)clampd(bi - floor(half) + 1, 3, parent->nx - 2 * half - 2);
  *pj0 = (int)clampd(bj - floor(half) + 1, 3, parent->ny - 2 * half - 2);
}

// (stormJ falls back to ny // 2 only when there is no storm centre at all, as in the Luau's
// `parent.stormJ or parent.ny // 2`)
EXPORT(cm_nest_place) int cm_nest_place(Model *parent, int nxn, int ratio) {
  int i0, j0;
  place(parent, nxn, ratio, &i0, &j0);
  return i0 + 65536 * j0;
}

static void recentre(Model *parent, Model *nest) {
  int k = cm_level_at(nest, 250);
  double best = 0, bi = 0, bj = 0;
  Model *c = nest->child;
  if (c && c->holding) {
    // its own nest holds a vortex (the 62.5 m nest a tornado): this nest follows that, at its
    // child's middle - searching on its own it jumped to another spin 4 km off and dragged the
    // child, which has to stay inside it, off its tornado (2026-11-05)
    best = nest->vortex;
    bi = c->i0 - 0.5 + 0.5 * c->nx / c->ratio;
    bj = c->j0 - 0.5 + 0.5 * c->ny / c->ratio;
  } else {
    // (from the second cell in: a vortex drifting to the edge was missed from the third, and the
    // nest stayed on a weaker spin while its tornado sat half outside it, 2026-11-05)
    for (int j = 2; j <= nest->ny - 1; j++)
      for (int i = 2; i <= nest->nx - 1; i++) {
        double z = zetaSmooth(nest, i, j, k);
        if (z > best) { best = z; bi = i; bj = j; }
      }
  }
  int r = nest->ratio;
  int di = 0, dj = 0, ni = 1, nj = 1;
  int tethered = 1;
  // (not while its own nest holds a vortex: the tether is against wandering after weak spin, and a
  // tornado the engine still has down drifts behind its storm - the model's formed 7 km from the
  // updraught, drifted back past 8 km and the tether snapped both nests off it, 2026-11-05)
  if (parent->stormI != 0 && best >= nest->vortex && !(c && c->holding)) {
    double vi = nest->i0 - 0.5 + (bi - 0.5) / r, vj = nest->j0 - 0.5 + (bj - 0.5) / r;
    double ei = vi - parent->stormI, ej = vj - parent->stormJ;
    tethered = sqrt(ei * ei + ej * ej) <= TETHER;
  }
  nest->holding = best >= nest->vortex && tethered;
  if (nest->holding) {
    // a vortex of its own: back near the centre, up to RECENTRE_MAX parent cells a minute (one
    // cell a minute let the 62.5 m nest lose a tornado drifting faster than 4 m/s, 2026-11-05)
    double off = 2 * r;
    double ci = nest->nx / 2.0, cj = nest->ny / 2.0;
    di = bi > ci + off ? 1 : (bi < ci - off ? -1 : 0);
    dj = bj > cj + off ? 1 : (bj < cj - off ? -1 : 0);
    ni = (int)fmin(RECENTRE_MAX, ceil((fabs(bi - ci) - off) / r));
    nj = (int)fmin(RECENTRE_MAX, ceil((fabs(bj - cj) - off) / r));
  } else {
    int ti, tj;
    place(parent, nest->nx, r, &ti, &tj);
    di = ti > nest->i0 ? 1 : (ti < nest->i0 ? -1 : 0);
    dj = tj > nest->j0 ? 1 : (tj < nest->j0 ? -1 : 0);
    // (nests keep their place when the parent moves, so this is how they follow it: as fast as
    // with a vortex)
    ni = (int)fmin(RECENTRE_MAX, abs(ti - nest->i0));
    nj = (int)fmin(RECENTRE_MAX, abs(tj - nest->j0));
  }
  int n = ni > nj ? ni : nj;
  for (int s = 0; s < n; s++) {
    int mi = s < ni ? di : 0, mj = s < nj ? dj : 0;
    double half = (double)nest->nx / r;
    if (nest->i0 + mi < 3 || nest->i0 + mi + half > parent->nx - 2) mi = 0;
    if (nest->j0 + mj < 3 || nest->j0 + mj + (double)nest->ny / r > parent->ny - 2) mj = 0;
    if (mi == 0 && mj == 0) return;
    nest->i0 += mi;
    nest->j0 += mj;
    nest->X0 += mi * parent->dx;
    nest->Y0 += mj * parent->dx;
    buildBoundary(nest, parent);
    shiftBy(nest, mi, mj, r);
  }
}

static void advance(Model *m) {
  Model *child = m->child;
  size_t bytes = (size_t)(m->N + 1) * sizeof(double);
  if (child)
    for (int q = 0; q < NPROG; q++) memcpy(child->pOldP[q], m->f[q], bytes);
  step(m);
  if (child) {
    child->env = m->env;
    child->cpRate = m->cpRate;
    child->cpTop = m->cpTop;
    child->drive = m->drive;
    child->drive2 = m->drive2;
    for (int s = 1; s <= child->steps; s++) {
      child->bcA = (double)s / child->steps;
      advance(child);
    }
    if (child->feedback) feed(m, child);
    if (floor(child->time / 60) != floor((child->time - m->dt) / 60)) recentre(m, child);
  }
}

// one step of the whole chain (Nest.step): the root follows its storm, its nests move with it
EXPORT(cm_nest_step) void cm_nest_step(Model *parent) {
  int ox = parent->ox, oy = parent->oy;
  followStorm(parent);
  int di = parent->ox - ox, dj = parent->oy - oy;
  if ((di != 0 || dj != 0) && parent->child) keepPlace(parent, parent->child, di, dj, 1);
  advance(parent);
}

// ---- access for the JavaScript side -------------------------------------------------------

// field pointers: 0-9 the prognostic fields (u v w p th qv qc qr qh qsn), 10-19 their step-start
// copies, 20-29 their tendencies, 30 B, 31 surface rain, 32 surface hail; levels (offset by 2:
// level k at element k + 2) 40 zf, 41 zc, 42 dzc, 43 dzw, 44 th0, 45 qv0, 46 u0, 47 v0, 48 pi0,
// 49 p0, 50 rho0, 51 rhow, 52-55 lapTh, lapQv, lapU, lapV, 56-59 env th, qv, u, v (to write)
EXPORT(cm_ptr) double *cm_ptr(Model *m, int id) {
  if (id < 10) return m->f[id];
  if (id < 20) return m->fS[id - 10];
  if (id < 30) return m->R[id - 20];
  switch (id) {
  case 30: return m->B;
  case 31: return m->rainSfc;
  case 32: return m->hailSfc;
  }
  double *L[20] = {m->zf, m->zc, m->dzc, m->dzw, m->th0, m->qv0, m->u0, m->v0, m->pi0, m->p0, m->rho0, m->rhow, m->lapTh, m->lapQv, m->lapU, m->lapV, m->envTh, m->envQv, m->envU, m->envV};
  if (id >= 40 && id < 60) return L[id - 40] - 2;
  return 0;
}

// scalars: 0 time, 1 umove, 2 vmove, 3 ox, 4 oy, 5 stormI, 6 stormJ, 7 uhMax, 8 cpRate, 9 psfc,
// 10 dx, 11 dt, 12 nx, 13 ny, 14 nz, 15 SX, 16 SXY, 17 N, 18 X0, 19 Y0, 20 i0, 21 j0, 22 ztop,
// 23 zdamp, 24 cd, 25 drive on, 26 drive2 on, 27 K, 28 Kh, 29 ratio, 30-39 feedJump (PROG order),
// 41 n0h, 42 cpTop
EXPORT(cm_get) double cm_get(Model *m, int id) {
  switch (id) {
  case 0: return m->time;
  case 1: return m->umove;
  case 2: return m->vmove;
  case 3: return m->ox;
  case 4: return m->oy;
  case 5: return m->stormI;
  case 6: return m->stormJ;
  case 7: return m->uhMax;
  case 8: return m->cpRate;
  case 9: return m->psfc;
  case 10: return m->dx;
  case 11: return m->dt;
  case 12: return m->nx;
  case 13: return m->ny;
  case 14: return m->nz;
  case 15: return m->SX;
  case 16: return m->SXY;
  case 17: return m->N;
  case 18: return m->X0;
  case 19: return m->Y0;
  case 20: return m->i0;
  case 21: return m->j0;
  case 22: return m->ztop;
  case 23: return m->zdamp;
  case 24: return m->cd;
  case 25: return m->drive.on;
  case 26: return m->drive2.on;
  case 27: return m->K;
  case 28: return m->Kh;
  case 29: return m->ratio;
  case 41: return m->n0h;
  case 42: return m->cpTop;
  }
  if (id >= 30 && id < 40) return m->feedJump[id - 30];
  return NAN;
}

EXPORT(cm_set) void cm_set(Model *m, int id, double x) {
  switch (id) {
  case 0: m->time = x; break;
  case 8: m->cpRate = x; break;
  case 41: m->n0h = x; break; // the hail size distribution's intercept (EngineRun steerHail)
  case 42: m->cpTop = x; break; // the cold pool's top (m; EngineRun, from the engine's depth)
  case 27: m->K = x; break; // vertical mixing (m^2/s)
  case 28: m->Kh = x; break; // horizontal mixing (m^2/s)
  }
}

EXPORT(cm_child) Model *cm_child(Model *m) { return m->child; }
