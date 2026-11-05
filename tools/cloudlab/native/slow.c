// The cloud model's slow tendencies (CloudModel.slow in roblox/src/cloudlab/shared/Model) in C:
// a speed test of option B (docs/cloudlab/PLAN.md C2). The same sums in the same order as the
// Luau, on 1-based arrays like the Luau's, so the results can be compared value for value.
//   slow <dump dir> <reps>   (the dump from dump_slow.luau, plus params.txt from run_slow.mjs)
// Build: zig cc -O3 -ffp-contract=off -o slow.exe slow.c
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
#include <windows.h>
static double now(void) {
  LARGE_INTEGER f, c;
  QueryPerformanceFrequency(&f);
  QueryPerformanceCounter(&c);
  return (double)c.QuadPart / (double)f.QuadPart;
}
#else
static double now(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + 1e-9 * t.tv_nsec;
}
#endif

#define G 9.81
static const double PI = 3.14159265358979323846;

typedef struct {
  int nx, ny, nz, SX, SXY, N;
  double dx, K, Kh, zdamp, ztop, umove, vmove, cd;
  double *u, *v, *w, *th, *qv, *qc, *qr, *qh, *qsn;
  double *Ru, *Rv, *Rw, *Rth, *Rqv, *Rqc, *Rqr, *Rqh, *Rqsn, *B;
  // levels, index k from -1: stored at k + 1 (lev[k] = base[k + 1])
  double *th0, *qv0, *u0, *v0, *zc, *zf, *dzc, *dzw, *lapTh, *lapQv, *lapU, *lapV;
  int *lo[4], *hi[4];
} Model;

static inline double up3(const double *f, int n, int s, double a, double c) {
  if (a >= 0) return a * c * (2 * f[n + s] + 3 * f[n] - 6 * f[n - s] + f[n - 2 * s]);
  return a * c * (-f[n + 2 * s] + 6 * f[n + s] - 3 * f[n] - 2 * f[n - s]);
}

static inline double lap(const double *f, int n, int sy, int sz, double kh, double kv, double up, double dn) {
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

#define L(arr, k) ((arr)[(k) + 1])

static void slow(Model *m) {
  int nx = m->nx, ny = m->ny, nz = m->nz, SX = m->SX, SXY = m->SXY;
  double *u = m->u, *v = m->v, *w = m->w, *th = m->th, *qv = m->qv;
  double *Ru = m->Ru, *Rv = m->Rv, *Rw = m->Rw, *Rth = m->Rth, *Rqv = m->Rqv, *B = m->B;
  double cx = 1 / (6 * m->dx), K = m->K, kh = m->Kh / (m->dx * m->dx);
  int sy = SX, sz = SXY;
  double zd = m->zdamp, ztop = m->ztop, um = m->umove, vm = m->vmove;
  double u0g = L(m->u0, 1), v0g = L(m->v0, 1);
  double s0 = sqrt(u0g * u0g + v0g * v0g);
  int SY = SXY / SX, nrows = m->N / SX;
  const double *HF[4] = {m->qc, m->qr, m->qh, m->qsn};
  double *HR[4] = {m->Rqc, m->Rqr, m->Rqh, m->Rqsn};
  for (int f = 0; f < 4; f++) rowSpans(HF[f], SX, nrows, m->lo[f], m->hi[f]);
  for (int k = 1; k <= nz; k++) {
    double t0 = L(m->th0, k), q0 = L(m->qv0, k);
    for (int j = 1; j <= ny; j++) {
      int n = 2 + (j + 1) * SX + (k + 1) * SXY;
      for (int i = 1; i <= nx; i++) {
        int c = n + i;
        B[c] = G * ((th[c] - t0) / t0 + 0.61 * (qv[c] - q0) - m->qc[c] - m->qr[c] - m->qh[c] - m->qsn[c]);
      }
    }
  }
  for (int k = 1; k <= nz; k++) {
    double z = L(m->zc, k);
    double damp = z > zd ? (1 - cos(0.5 * PI * (z - zd) / (ztop - zd))) / 300 : 0;
    double dampW = L(m->zf, k) > zd ? (1 - cos(0.5 * PI * (L(m->zf, k) - zd) / (ztop - zd))) / 300 : 0;
    double ue = L(m->u0, k) - um, ve = L(m->v0, k) - vm;
    double czc = 1 / (6 * L(m->dzc, k)), czw = 1 / (6 * L(m->dzw, k));
    double kvc = K / L(m->dzc, k), kvw = K / L(m->dzw, k);
    double upC = L(m->dzw, k + 1), dnC = L(m->dzw, k);
    double upW = L(m->dzc, k), dnW = L(m->dzc, k - 1);
    double cd = k == 1 ? m->cd / L(m->dzc, 1) : 0;
    double bTh = L(m->lapTh, k), bQv = L(m->lapQv, k), bU = L(m->lapU, k), bV = L(m->lapV, k);
    double th0k = L(m->th0, k);
    for (int j = 1; j <= ny; j++) {
      int n0 = 2 + (j + 1) * SX + (k + 1) * SXY;
      for (int i = 1; i <= nx; i++) {
        int n = n0 + i;
        double U = 0.5 * (u[n] + u[n + 1]);
        double V = 0.5 * (v[n] + v[n + sy]);
        double W = 0.5 * (w[n] + w[n + sz]);
        Rth[n] = -(up3(th, n, 1, U, cx) + up3(th, n, sy, V, cx) + up3(th, n, sz, W, czc)) + lap(th, n, sy, sz, kh, kvc, upC, dnC) - bTh - damp * (th[n] - th0k);
        Rqv[n] = -(up3(qv, n, 1, U, cx) + up3(qv, n, sy, V, cx) + up3(qv, n, sz, W, czc)) + lap(qv, n, sy, sz, kh, kvc, upC, dnC) - bQv;
        {
          double Vu = 0.25 * (v[n] + v[n - 1] + v[n + sy] + v[n - 1 + sy]);
          double Wu = 0.25 * (w[n] + w[n - 1] + w[n + sz] + w[n - 1 + sz]);
          double a = u[n];
          double r = -(up3(u, n, 1, a, cx) + up3(u, n, sy, Vu, cx) + up3(u, n, sz, Wu, czc)) + lap(u, n, sy, sz, kh, kvc, upC, dnC) - bU - damp * (a - ue);
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
          double r = -(up3(v, n, 1, Uv, cx) + up3(v, n, sy, a, cx) + up3(v, n, sz, Wv, czc)) + lap(v, n, sy, sz, kh, kvc, upC, dnC) - bV - damp * (a - ve);
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
          Rw[n] = -(up3(w, n, 1, Uw, cx) + up3(w, n, sy, Vw, cx) + up3(w, n, sz, a, czw)) + lap(w, n, sy, sz, kh, kvw, upW, dnW) + 0.5 * (B[n] + B[n - sz]) - dampW * a;
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
            double U = 0.5 * (u[n] + u[n + 1]);
            double V = 0.5 * (v[n] + v[n + sy]);
            double W = 0.5 * (w[n] + w[n + sz]);
            R[n] = -(up3(F, n, 1, U, cx) + up3(F, n, sy, V, cx) + up3(F, n, sz, W, czc)) + lap(F, n, sy, sz, kh, kvc, upC, dnC);
          }
        }
      }
    }
  }
}

static double *readArr(const char *dir, const char *name, const char *ext, int count) {
  char path[1024];
  snprintf(path, sizeof path, "%s/%s.%s", dir, name, ext);
  FILE *fp = fopen(path, "rb");
  if (!fp) { fprintf(stderr, "missing %s\n", path); exit(1); }
  // grids are 1-based (index 0 unused); levels are stored from k = -1
  double *a = calloc(count + 1, sizeof(double));
  size_t got = fread(strcmp(ext, "bin") == 0 ? a + 1 : a, sizeof(double), count, fp);
  fclose(fp);
  if ((int)got != count) { fprintf(stderr, "short %s\n", path); exit(1); }
  return a;
}

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "slow <dump dir> <reps>\n"); return 1; }
  const char *dir = argv[1];
  int reps = atoi(argv[2]);
  Model m;
  char path[1024];
  snprintf(path, sizeof path, "%s/params.txt", dir);
  FILE *pf = fopen(path, "r");
  if (!pf || fscanf(pf, "%d %d %d %d %d %d %lf %lf %lf %lf %lf %lf %lf %lf", &m.nx, &m.ny, &m.nz, &m.SX, &m.SXY, &m.N, &m.dx, &m.K, &m.Kh, &m.zdamp, &m.ztop, &m.umove, &m.vmove, &m.cd) != 14) {
    fprintf(stderr, "bad params\n");
    return 1;
  }
  fclose(pf);
  int N = m.N, NL = m.nz + 5;
  m.u = readArr(dir, "u", "bin", N); m.v = readArr(dir, "v", "bin", N); m.w = readArr(dir, "w", "bin", N);
  m.th = readArr(dir, "th", "bin", N); m.qv = readArr(dir, "qv", "bin", N); m.qc = readArr(dir, "qc", "bin", N);
  m.qr = readArr(dir, "qr", "bin", N); m.qh = readArr(dir, "qh", "bin", N); m.qsn = readArr(dir, "qsn", "bin", N);
  m.th0 = readArr(dir, "th0", "lev", NL); m.qv0 = readArr(dir, "qv0", "lev", NL); m.u0 = readArr(dir, "u0", "lev", NL);
  m.v0 = readArr(dir, "v0", "lev", NL); m.zc = readArr(dir, "zc", "lev", NL); m.zf = readArr(dir, "zf", "lev", NL);
  m.dzc = readArr(dir, "dzc", "lev", NL); m.dzw = readArr(dir, "dzw", "lev", NL); m.lapTh = readArr(dir, "lapTh", "lev", NL);
  m.lapQv = readArr(dir, "lapQv", "lev", NL); m.lapU = readArr(dir, "lapU", "lev", NL); m.lapV = readArr(dir, "lapV", "lev", NL);
  double **outs[10] = {&m.Ru, &m.Rv, &m.Rw, &m.Rth, &m.Rqv, &m.Rqc, &m.Rqr, &m.Rqh, &m.Rqsn, &m.B};
  for (int q = 0; q < 10; q++) *outs[q] = calloc(N + 1, sizeof(double));
  int nrows = N / m.SX;
  for (int f = 0; f < 4; f++) { m.lo[f] = calloc(nrows, sizeof(int)); m.hi[f] = calloc(nrows, sizeof(int)); }
  slow(&m);
  double t0 = now();
  for (int r = 0; r < reps; r++) slow(&m);
  double ms = 1000 * (now() - t0) / reps;
  // compare with the Luau's tendencies
  const char *names[10] = {"Ru", "Rv", "Rw", "Rth", "Rqv", "Rqc", "Rqr", "Rqh", "Rqsn", "B"};
  double worst = 0;
  long differ = 0;
  for (int q = 0; q < 10; q++) {
    double *ref = readArr(dir, names[q], "bin", N), *got = *outs[q];
    for (int n = 1; n <= N; n++) {
      if (ref[n] != got[n]) {
        differ++;
        double scale = fabs(ref[n]) > 1e-30 ? fabs(ref[n]) : 1e-30;
        double rel = fabs(ref[n] - got[n]) / scale;
        if (rel > worst) worst = rel;
      }
    }
    free(ref);
  }
  printf("C slow(): %.2f ms per call; %ld of %d values differ from the Luau (worst relative %.2e)\n", ms, differ, 10 * N, worst);
  return 0;
}
