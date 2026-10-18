"""HELIOS Agent Studio — tell the agents an idea, they build and test it on the live city.

    helios_studio (SequentialAgent)
      1. designer            idea → concrete changes from this area's simulated candidates (+ shocks, e.g. today's haze)
      2. analyst             runs the calibrated 2026–2036 simulation on the plan
      3. compliance_officer  taxonomy / Green Mark / EV Charging Act / carbon price, with clause citations
      4. site_analyst        nature, flood, heat and live air-quality screen at every site
      5. red_team            argues against the plan using only the numbers above
      6. narrator            the answer, every number traceable to a tool result (citation guardrail)

Tools are thin HTTP calls to the HELIOS app (/api/studio/tools): agents choose, sequence and
explain; deterministic code computes. The plan lives in session state, so follow-ups
("drop the bus lane", "what if the haze lasts 60 days?") edit the same plan.

Model: HELIOS_MODEL (default gemini-2.5-flash). For an OpenAI-compatible model (e.g. local Gemma
via llama.cpp) set HELIOS_MODEL=openai/<model> and OPENAI_API_BASE / OPENAI_API_KEY (LiteLLM).
"""
from __future__ import annotations

import json
import os
from typing import Optional

import requests
from google.adk.agents import LlmAgent, SequentialAgent
from google.adk.tools import ToolContext

from .agent import _citation_guard, _remember_tool_result
from .shock_schema import _ADAPTER as SHOCK_ADAPTER

APP_URL = os.environ.get("HELIOS_APP_URL", "http://localhost:3000").rstrip("/")


def _model():
    name = os.environ.get("HELIOS_MODEL", "gemini-2.5-flash")
    if name.startswith("openai/") or name.startswith("litellm/"):
        from google.adk.models.lite_llm import LiteLlm

        return LiteLlm(model=name.removeprefix("litellm/"))
    return name


def _call(tool: str, **args) -> dict:
    try:
        r = requests.post(f"{APP_URL}/api/studio/tools", json={"tool": tool, "args": args}, timeout=180)
        d = r.json()
    except Exception as e:  # noqa: BLE001
        return {"error": f"HELIOS app unreachable at {APP_URL}: {e}"}
    return d["result"] if d.get("ok") else {"error": d.get("error", f"HTTP {r.status_code}")}


# ---- tools ---------------------------------------------------------------------------------------

def list_areas() -> dict:
    """List the Singapore planning areas that have a calibrated simulation (id, name, residents)."""
    return _call("list_areas")


def area_profile(area: str) -> dict:
    """Census and environment profile of a planning area (use the area id, e.g. 'tampines')."""
    return _call("area_profile", area=area)


def list_candidate_changes(area: str, kind: str = "") -> dict:
    """Concrete, already-costed changes for an area: shaded walkways, protected cycle links, bus priority,
    solar canopies, EV hubs. Optional kind filter: shaded_walkway | protected_cycle_link | bus_priority |
    solar_canopy | ev_charging_hub. Returns ids to use in set_plan."""
    return _call("list_candidate_changes", area=area, kind=kind or None)


def set_plan(area: str, change_ids: list[str], tool_context: ToolContext) -> dict:
    """Set (replace) the plan: the area id and the candidate change ids to build. Call again to edit the plan."""
    check = _call("get_modifiers", area=area, change_ids=change_ids)
    if "error" in check:
        return check
    tool_context.state["plan_area"] = area
    tool_context.state["plan_ids"] = list(change_ids)
    return {"ok": True, "area": area, "changes": [m["label"] for m in check["modifiers"]]}


def live_air(city: str = "singapore") -> dict:
    """Today's measured air quality (Singapore: NEA 24-h PSI by region). Use before injecting haze."""
    return _call("air_quality", city=city)


def inject_haze(psi: float, days_per_year: int, tool_context: ToolContext, start_year: int = 2026, duration_years: int = 3) -> dict:
    """Test the plan under transboundary haze: psi = typical 24-h PSI on haze days, days_per_year = haze days."""
    return _add_shock({"type": "haze", "startYear": start_year, "durationYears": duration_years, "psi": psi, "daysPerYear": days_per_year}, tool_context)


def inject_shock(shock_json: str, tool_context: ToolContext) -> dict:
    """Add any validated shock as JSON, e.g. {"type":"heatwave","startYear":2028,"durationYears":3,"severity":0.6}.
    Types: heatwave, heavy_rain, oil_price_spike, pandemic, grid_carbon_spike, mrt_loop_closure, haze."""
    try:
        shock = json.loads(shock_json)
    except json.JSONDecodeError as e:
        return {"error": f"not JSON: {e}"}
    return _add_shock(shock, tool_context)


def clear_shocks(tool_context: ToolContext) -> dict:
    """Remove all shocks from the scenario."""
    tool_context.state["shocks"] = []
    return {"ok": True}


def _add_shock(shock: dict, tool_context: ToolContext) -> dict:
    try:
        valid = SHOCK_ADAPTER.validate_python(shock).model_dump()
    except Exception as e:  # noqa: BLE001
        return {"error": f"shock rejected by schema: {e}"}
    shocks = [s for s in tool_context.state.get("shocks", []) if s["type"] != valid["type"]] + [valid]
    tool_context.state["shocks"] = shocks
    return {"ok": True, "shocks": shocks}


def _plan(tool_context: ToolContext) -> Optional[dict]:
    area, ids = tool_context.state.get("plan_area"), tool_context.state.get("plan_ids")
    return {"area": area, "change_ids": ids} if area and ids else None


def simulate_current_plan(tool_context: ToolContext) -> dict:
    """Run the calibrated 2026–2036 simulation on the current plan and shocks."""
    p = _plan(tool_context)
    if not p:
        return {"error": "No plan yet — the designer must call set_plan first."}
    return _call("simulate_plan", **p, shocks=tool_context.state.get("shocks", []))


def check_current_plan_compliance(tool_context: ToolContext) -> dict:
    """Taxonomy, Green Mark, EV Charging Act and carbon-price checks for every change in the plan."""
    p = _plan(tool_context)
    return _call("check_compliance", **p) if p else {"error": "No plan yet."}


def screen_current_plan_sites(tool_context: ToolContext) -> dict:
    """Nature, flood and heat screen at each change's location."""
    p = _plan(tool_context)
    return _call("screen_sites", **p) if p else {"error": "No plan yet."}


# ---- agents --------------------------------------------------------------------------------------

HONESTY = (
    "Only state numbers that appear in your tool results or in the results quoted below. Name what each "
    "number is. Mode shifts are a calibrated, modelled reallocation, not a forecast. Be brief."
)
common = dict(after_tool_callback=_remember_tool_result)


def build_studio():
    model = _model()
    designer = LlmAgent(
        name="designer",
        model=model,
        description="Turns the planner's idea into a concrete plan of costed changes.",
        instruction=(
            "You design a plan for ONE Singapore planning area from the planner's message. Area ids are lowercase "
            "with underscores (e.g. tampines, ang_mo_kio). If unsure of the id call list_areas. Call "
            "list_candidate_changes for the area, pick 1–5 candidate ids that best match the idea (respect any "
            "budget: sum capex_sgd), then call set_plan. If the message mentions haze, smoke, air or PSI, call "
            "live_air then inject_haze with today's worst-region PSI (days_per_year 30 unless given). Other events "
            "(heatwave, oil price, pandemic…) go through inject_shock. If the planner is editing an existing plan, "
            "call set_plan again with the new list. Finish with 2–3 sentences: which changes and why. " + HONESTY
        ),
        tools=[list_areas, area_profile, list_candidate_changes, set_plan, live_air, inject_haze, inject_shock, clear_shocks],
        output_key="design",
        **common,
    )
    analyst = LlmAgent(
        name="analyst",
        model=model,
        description="Simulates the plan on the calibrated city model.",
        instruction="Call simulate_current_plan once. Report CO₂ avoided (with band), cost per tonne, heat, trips off cars, benefit-cost ratio and any shock. " + HONESTY,
        tools=[simulate_current_plan],
        output_key="impact",
        **common,
    )
    compliance = LlmAgent(
        name="compliance_officer",
        model=model,
        description="Checks the plan against Singapore rules.",
        instruction="Call check_current_plan_compliance once. Summarise each change's taxonomy grade and any rule flag in one line each. " + HONESTY,
        tools=[check_current_plan_compliance],
        output_key="compliance",
        **common,
    )
    site = LlmAgent(
        name="site_analyst",
        model=model,
        description="Screens every site for nature, flood, heat and air.",
        instruction="Call screen_current_plan_sites once. Name any site with an elevated or high flag and why; otherwise say the sites are clear. " + HONESTY,
        tools=[screen_current_plan_sites],
        output_key="site_risk",
        **common,
    )
    red_team = LlmAgent(
        name="red_team",
        model=model,
        description="Argues against the plan.",
        instruction=(
            "You are the sceptical reviewer. Using only these results:\nDESIGN: {design?}\nIMPACT: {impact?}\n"
            "COMPLIANCE: {compliance?}\nSITES: {site_risk?}\nGive the two strongest reasons a funder should hesitate "
            "(e.g. cost per tonne vs carbon price, embodied carbon payback, a site flag, haze sensitivity) and one "
            "change that would most improve the plan. No new numbers. Max 4 sentences."
        ),
        output_key="critique",
    )
    narrator = LlmAgent(
        name="narrator",
        model=model,
        description="Writes the final answer for the planner.",
        instruction=(
            "Write the answer for the planner from these results only:\nDESIGN: {design?}\nIMPACT: {impact?}\n"
            "COMPLIANCE: {compliance?}\nSITES: {site_risk?}\nCRITIQUE: {critique?}\nFormat: one-line verdict, then "
            "'Plan', 'Impact', 'Rules', 'Sites', 'Watch out' as short bullet sections. Copy numbers exactly as given. "
            "End by inviting a follow-up edit (e.g. swap a change, add a shock)."
        ),
        output_key="answer",
        after_model_callback=_citation_guard,
    )
    return SequentialAgent(
        name="helios_studio",
        description="HELIOS Agent Studio: design → simulate → comply → screen → challenge → answer.",
        sub_agents=[designer, analyst, compliance, site, red_team, narrator],
    )


root_agent = build_studio()
