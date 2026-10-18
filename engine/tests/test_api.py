from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)


def test_health_lists_calibrated_files():
    r = client.get("/health").json()
    assert r["ok"] and "mode_choice_calibrated.json" in r["calibrated"]


def test_provenance_has_sources_with_dates():
    reg = client.get("/provenance").json()
    assert "mode_by_pa_res_2025" in reg
    assert reg["mode_by_pa_res_2025"]["as_of"] == "2025"


def test_validation_reports_out_of_sample_metrics():
    v = client.get("/validation").json()
    t = v["mode_choice"]["temporal_holdout_2020_to_2025"]
    assert t["calibrated_persistence_plus_national_trend"]["weighted_mae_pp"] < t["baseline_national_share"]["weighted_mae_pp"]


def test_charger_tool():
    r = client.post("/tools/size-chargers", json={"peak_arrivals_per_hour": 6, "mean_charge_hours": 1}).json()
    assert r["p_wait_over_target"] <= 0.05


def test_voi_tool_gate():
    draws = [[1e6, 0.0]] * 50
    r = client.post("/tools/value-of-information", json={"net_benefit_draws": draws}).json()
    assert r["evpi"] == 0 and r["gate"]["verdict"] == "FUND"


def test_dispatch_tool_validates_length():
    assert client.post("/tools/dispatch", json={"load_kwh": [1] * 5, "pv_kwh": [0] * 5, "price": [0.3] * 5, "ef_kg_per_kwh": [0.4] * 5}).status_code == 422
