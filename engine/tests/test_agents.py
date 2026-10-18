"""Agent layer tests that need no API key: tools return real numbers with sources, the shock
validator is strict, retrieval finds the right datasets, guardrails catch invented numbers."""
import json

from helios_engine.agents import tools as T
from helios_engine.agents.guardrails import check_answer
from helios_engine.agents.librarian import search_catalog
from helios_engine.agents.shock_schema import validate_shock


def test_every_tool_returns_sources():
    outs = [
        T.list_interventions(),
        T.recommend_portfolio(1_500_000, 0.5),
        T.value_of_information(),
        T.pathway_regret(),
        T.model_validation(),
        T.heat_at_hour(13),
        T.size_ev_chargers(8, 1.5),
        T.find_datasets("hawker centres"),
    ]
    for o in outs:
        assert o.get("sources"), o


def test_portfolio_respects_budget():
    r = T.recommend_portfolio(1_000_000, 0.5)
    assert r["capex_usd"] <= 1_000_000 and r["selected"]


def test_value_of_information_is_consistent():
    v = T.value_of_information()
    assert v["evpi_usd"] >= max(v["evppi_usd"].values()) - 1


def test_shock_validator_strict():
    ok = validate_shock(json.dumps({"type": "oil_price_spike", "startYear": 2027, "durationYears": 1, "carCostIncreasePct": 30}))
    assert ok["valid"]
    assert not validate_shock(json.dumps({"type": "oil_price_spike", "startYear": 2027, "durationYears": 1, "carCostIncreasePct": 900}))["valid"]
    assert not validate_shock(json.dumps({"type": "alien_invasion", "startYear": 2027, "durationYears": 1}))["valid"]
    assert not validate_shock("not json")["valid"]


def test_librarian_finds_relevant_tables():
    titles = " ".join(r["title"].lower() for r in search_catalog("resident population by planning area subzone age", 8))
    assert "subzone" in titles or "planning area" in titles
    titles = " ".join(r["title"].lower() for r in search_catalog("hawker centres", 5, semantic=False))
    assert "hawker" in titles


def test_guardrail_accepts_traced_numbers_and_flags_invented_ones():
    tool_out = [T.heat_at_hour(13)]
    u = tool_out[0]["utci_sun_c"]
    good = f"At 1pm the felt temperature in sun is {u:.1f}°C."
    assert check_answer(good, tool_out)["ok"]
    bad = "At 1pm the felt temperature in sun is 47.9°C and the walkway will cut it by 12.3°C."
    r = check_answer(bad, tool_out)
    assert not r["ok"] and r["unsupported_numbers"]


def test_guardrail_flags_overclaims():
    r = check_answer("This walkway guarantees a mode shift.", [])
    assert r["overclaims"]


def test_agent_team_constructs():
    from helios_engine.agents.agent import root_agent

    names = {a.name for a in root_agent.sub_agents}
    assert {"planner", "red_team", "librarian"} <= names
