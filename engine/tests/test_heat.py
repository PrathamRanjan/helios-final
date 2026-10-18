import numpy as np
import pandas as pd
import pytest

from helios_engine.heat.shade import HeightGrid, shaded
from helios_engine.heat.utci import stull_wet_bulb, utci_sun_shade, wind_at_pedestrian


def _wall_east():
    """A 30 m tall wall occupying x ∈ [50, 60) m, all y, on a 5 m grid; point at x=0."""
    h = np.zeros((40, 40))
    h[:, 10:12] = 30.0
    return HeightGrid(h, x0=-50.0, y0=-100.0, cell=5.0)


def test_wall_to_the_east_shades_in_the_morning_not_afternoon():
    g = _wall_east()
    x, y = np.array([0.0]), np.array([0.0])
    # Morning sun low in the east (azimuth 90°, elevation 20°): ray east hits the wall (30 m > 55·tan20°≈20 m)
    assert shaded(g, x, y, elev_deg=20, az_deg=90)[0]
    # Afternoon sun in the west: ray goes away from the wall → sunlit
    assert not shaded(g, x, y, elev_deg=20, az_deg=270)[0]
    # High noon (elevation 85°): shadow too short to reach the point
    assert not shaded(g, x, y, elev_deg=85, az_deg=90)[0]


def test_no_buildings_no_shade_and_night_counts_as_no_sun():
    g = HeightGrid(np.zeros((10, 10)), 0, 0, 5.0)
    assert not shaded(g, np.array([20.0]), np.array([20.0]), 40, 180)[0]
    assert shaded(g, np.array([20.0]), np.array([20.0]), -5, 180)[0]


def test_stull_wet_bulb_reference_value():
    # Stull (2011): T = 20 °C, RH = 50 % → Tw ≈ 13.7 °C
    assert float(stull_wet_bulb(20.0, 50.0)) == pytest.approx(13.7, abs=0.1)


def test_wind_profile_reduces_to_pedestrian_height():
    assert float(wind_at_pedestrian(4.0)) < 4.0
    assert float(wind_at_pedestrian(0.1)) == pytest.approx(0.5)  # floor for UTCI validity


def test_shade_is_cooler_than_sun_at_midday():
    clim = pd.DataFrame({"temp_c": [30.5], "rh_pct": [68.0], "wind_ms": [2.0]}, index=[13])
    u = utci_sun_shade(clim, clearness_k=0.66)
    assert u.loc[13, "utci_sun"] > u.loc[13, "utci_shade"] + 3
    assert u.loc[13, "mrt_sun"] > u.loc[13, "mrt_shade"] + 10
