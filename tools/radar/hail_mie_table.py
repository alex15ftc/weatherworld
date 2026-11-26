"""Backscatter of hailstones at the WSR-88D's wavelength (S band, 10.7 cm), by Mie theory, for the
radar simulator's hail reflectivity (js/storms/PrecipitationField.js HAIL_MIE).

For each stone (ice) diameter D (mm) it prints the equivalent reflectivity per gram of stone (ice and
the water on it) per cubic metre, as a factor on the Rayleigh value of liquid drops of that size,
1910 D^3 (mm^6 m^-3 per g m^-3):
  f = Ze / (M * 1910 D^3),  Ze = lambda^4 / (pi^5 |Kw|^2) * sigma_b * N
- dry: a solid ice sphere (density 0.9; bhmie);
- wet: the ice sphere inside a shell of meltwater, as much as a melting stone holds before it sheds
  the rest (Rasmussen and Heymsfield 1987, JAS 44: m_w = 0.268 + 0.1389 m_i grams, at most its own
  ice mass), the coated sphere of Bohren and Huffman 1983 (bhcoat). Melting hail's radar signatures
  come from that water film (Ryzhkov et al. 2013, JAMC 52), not from the stone turning to water.
Each entry is the mean over stones within 20% of the size (weighted by Ze per stone, D^6), as stones
in a class are not all one size and a single size's resonances would make the echo jump.
Small dry stones give |K_ice|^2 / |K_w|^2 / 0.9 = 0.21 (Rayleigh).

Refractive indices at 2.8 GHz: water at 0 C from the Debye relaxation (eps_s 87.9, eps_inf 5.7,
tau 17.7 ps; Ray 1972), ice 3.17 + 0.0009i (Warren and Brandt 2008); n + ik as bhmie takes them.
Run: py tools/radar/hail_mie_table.py
"""
import cmath
import numpy as np

LAMBDA_MM = 107.0
K_W2 = 0.93
EPS_W = np.conj(5.7 + (87.9 - 5.7) / (1 + 1j * 2 * np.pi * 2.8e9 * 17.7e-12))
M_WATER, M_ICE = np.sqrt(EPS_W), np.sqrt(3.17 + 0.0009j)


def sphere_qback(x, m):
    """Backscattering efficiency sigma_b / (pi r^2) of a sphere, size parameter x (bhmie)."""
    nmax = int(round(x + 4.05 * x ** (1 / 3) + 2)) + 2
    mx = m * x
    nmx = int(round(max(nmax, abs(mx)) + 16))
    d = np.zeros(nmx, dtype=complex)
    for n in range(nmx - 1, 0, -1):
        d[n - 1] = n / mx - 1.0 / (d[n] + n / mx)
    psi0, psi1, chi0, chi1 = np.cos(x), np.sin(x), -np.sin(x), np.cos(x)
    xi1 = complex(psi1, -chi1)
    total = 0j
    for n in range(1, nmax + 1):
        psi = (2 * n - 1) * psi1 / x - psi0
        chi = (2 * n - 1) * chi1 / x - chi0
        xi = complex(psi, -chi)
        a = ((d[n] / m + n / x) * psi - psi1) / ((d[n] / m + n / x) * xi - xi1)
        b = ((m * d[n] + n / x) * psi - psi1) / ((m * d[n] + n / x) * xi - xi1)
        total += (2 * n + 1) * (-1) ** n * (a - b)
        psi0, psi1, chi0, chi1, xi1 = psi1, psi, chi1, chi, xi
    return abs(total) ** 2 / x ** 2


def coated_qback(x, y, m1, m2, tol=1e-8):
    """The same for a core (size parameter x, index m1) inside a shell out to y (index m2) (bhcoat)."""
    x1, x2, y2 = m1 * x, m2 * x, m2 * y
    nstop = int(y + 4 * y ** (1 / 3) + 2)
    refrel = m2 / m1
    cot = lambda z: cmath.cos(z) / cmath.sin(z)
    d0x1, d0x2, d0y2 = cot(x1), cot(x2), cot(y2)
    psi0y, psi1y, chi0y, chi1y = np.cos(y), np.sin(y), -np.sin(y), np.cos(y)
    xi1y = psi1y - 1j * chi1y
    chi0y2, chi1y2, chi0x2, chi1x2 = -cmath.sin(y2), cmath.cos(y2), -cmath.sin(x2), cmath.cos(x2)
    xback, done, brack, crack = 0j, False, 0j, 0j
    chipy2 = chiy2 = 0j
    for n in range(1, nstop + 1):
        psiy = (2 * n - 1) * psi1y / y - psi0y
        chiy = (2 * n - 1) * chi1y / y - chi0y
        xiy = psiy - 1j * chiy
        d1y2 = 1 / (n / y2 - d0y2) - n / y2
        if not done:
            d1x1 = 1 / (n / x1 - d0x1) - n / x1
            d1x2 = 1 / (n / x2 - d0x2) - n / x2
            chix2 = (2 * n - 1) * chi1x2 / x2 - chi0x2
            chiy2 = (2 * n - 1) * chi1y2 / y2 - chi0y2
            chipx2 = chi1x2 - n * chix2 / x2
            chipy2 = chi1y2 - n * chiy2 / y2
            ancap = (refrel * d1x1 - d1x2) / (refrel * d1x1 * chix2 - chipx2) / (chix2 * d1x2 - chipx2)
            brack = ancap * (chiy2 * d1y2 - chipy2)
            bncap = (refrel * d1x2 - d1x1) / (refrel * chipx2 - d1x1 * chix2) / (chix2 * d1x2 - chipx2)
            crack = bncap * (chiy2 * d1y2 - chipy2)
            if max(abs(brack * chipy2), abs(brack * chiy2), abs(crack * chipy2), abs(crack * chiy2)) <= tol * abs(d1y2):
                brack = crack = 0j
                done = True
            d0x1, d0x2 = d1x1, d1x2
            chi0x2, chi1x2, chi0y2, chi1y2 = chi1x2, chix2, chi1y2, chiy2
        dnbar = d1y2 if done else (d1y2 - brack * chipy2) / (1 - brack * chiy2)
        gnbar = d1y2 if done else (d1y2 - crack * chipy2) / (1 - crack * chiy2)
        an = ((dnbar / m2 + n / y) * psiy - psi1y) / ((dnbar / m2 + n / y) * xiy - xi1y)
        bn = ((m2 * gnbar + n / y) * psiy - psi1y) / ((m2 * gnbar + n / y) * xiy - xi1y)
        xback += (2 * n + 1) * (-1) ** n * (an - bn)
        psi0y, psi1y, chi0y, chi1y = psi1y, psiy, chi1y, chiy
        xi1y = psi1y - 1j * chi1y
        d0y2 = d1y2
    return abs(xback) ** 2 / y ** 2


def ze_factor(core_mm, wet):
    ice_g = 0.9 * np.pi / 6 * (core_mm / 10) ** 3
    water_g = min(ice_g, 0.268 + 0.1389 * ice_g) if wet else 0.0
    outer = (core_mm ** 3 + 6 * water_g * 1e3 / np.pi) ** (1 / 3)
    x, y = np.pi * core_mm / LAMBDA_MM, np.pi * outer / LAMBDA_MM
    q = coated_qback(x, y, M_ICE, M_WATER) if wet else sphere_qback(x, M_ICE)
    ze_per_stone = LAMBDA_MM ** 4 / (np.pi ** 5 * K_W2) * q * np.pi * (outer / 2) ** 2
    return ze_per_stone / (ice_g + water_g) / (1910 * core_mm ** 3)


def averaged(d, wet):
    ds = np.linspace(0.8 * d, 1.2 * d, 41)
    return sum(ze_factor(x, wet) * x ** 6 for x in ds) / sum(x ** 6 for x in ds)


if __name__ == '__main__':
    # (the coated sphere against plain ones: a vanishing shell is the ice sphere)
    assert abs(coated_qback(0.3, 0.3 + 1e-7, M_ICE, M_WATER) / sphere_qback(0.3, M_ICE) - 1) < 1e-3
    print('// [D mm, wet factor, dry factor]')
    for d in [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 100]:
        print(f'  [{d}, {averaged(d, True):.4g}, {averaged(d, False):.4g}],')
